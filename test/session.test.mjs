import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonLines, TurnOutput, SessionLanes, SessionStore, sessionKey, safeMessage, finalReply, bridgeRequest } from '../src/session.mjs';

const id = 'd5932f60-8894-4615-95d1-cda1e07e4076';
const result = (fields = {}) => ({ type: 'result', session_id: id, is_error: false, result: 'Final answer', ...fields });

// Every possible boundary includes split escape sequences, CRLF and Unicode.
test('chunked JSON framing preserves complete events and an unterminated final line', () => {
  const events = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello\n世界 🌍' }] } },
    result(),
  ];
  const wire = events.map(value => JSON.stringify(value)).join('\r\n');
  for (let at = 0; at <= wire.length; at++) {
    const received = [];
    const parser = new JsonLines(event => received.push(event));
    parser.push(wire.slice(0, at));
    parser.push(wire.slice(at));
    parser.finish();
    assert.deepEqual(received, events);
  }
});

test('invalid or oversized stream data is a visible protocol failure', () => {
  for (const wire of ['{broken}\n', 'null\n', '[1,2]\n']) {
    const parser = new JsonLines(() => assert.fail('Invalid frames must not be dispatched'));
    parser.push(wire);
    assert.throws(() => parser.finish(), /invalid stream JSON/);
  }
  const parser = new JsonLines(() => {}, 12);
  parser.push('x'.repeat(13));
  assert.throws(() => parser.finish(), /line limit/);
});

test('terminal result wins over intermediate assistant text and exposes tool denials', () => {
  const steps = [];
  const output = new TurnOutput(tool => steps.push(tool));
  output.accept({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working…' }, { type: 'tool_use', name: 'Read' }] } });
  output.accept(result({ permission_denials: [{ tool_name: 'Bash' }, { tool_name: 'Bash' }] }));
  assert.deepEqual(output.finish(0), { sessionId: id, text: 'Final answer', denials: ['Bash'] });
  assert.deepEqual(steps, ['Read']);
});

test('missing result, terminal errors, duplicate results and nonzero exits cannot succeed', () => {
  const missing = new TurnOutput();
  missing.accept({ type: 'assistant', message: { content: [{ type: 'text', text: 'Not a terminal result' }] } });
  assert.throws(() => missing.finish(0), /without a result/);
  const failed = new TurnOutput();
  failed.accept(result({ is_error: true, subtype: 'error_during_execution', permission_denials: [{ tool_name: 'Write' }] }));
  assert.throws(() => failed.finish(0), /Permission denied: Write/);
  const exited = new TurnOutput();
  exited.accept(result());
  assert.throws(() => exited.finish(1), /could not complete/);
  exited.accept(result());
  assert.throws(() => exited.finish(0), /multiple terminal results/);
  const bridge = new TurnOutput();
  bridge.accept({ type: 'bridge_error', message: 'Unlock the operating system credential store.' });
  assert.throws(() => bridge.finish(1), /Unlock/);
});

test('cancel after receiving a successful result still suppresses success', () => {
  const output = new TurnOutput();
  output.accept(result());
  assert.throws(() => output.finish(0, true), error => error.name === 'AbortError');
});

test('conversation keys isolate agent membership, relay and conversation without separator collisions', () => {
  const agent = { key: 'member', relay: 'wss://one.example' };
  const keys = [
    sessionKey(agent, { key: 'channel/thread' }),
    sessionKey({ ...agent, key: 'member2' }, { key: 'channel/thread' }),
    sessionKey({ ...agent, relay: 'wss://two.example' }, { key: 'channel/thread' }),
    sessionKey(agent, { key: 'channel/other' }),
    sessionKey({ key: 'a/b', relay: 'c' }, { key: 'd' }),
    sessionKey({ key: 'a', relay: 'b/c' }, { key: 'd' }),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test('one lane serializes turns, cancels queued work, recovers from failure and does not block another lane', async () => {
  const lanes = new SessionLanes();
  const signal = new AbortController().signal;
  const cancelled = new AbortController();
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = lanes.run('one', signal, async () => { order.push('first'); await gate; throw new Error('first failed'); });
  const firstFailed = assert.rejects(first, /first failed/);
  const second = lanes.run('one', cancelled.signal, () => assert.fail('Cancelled turn ran'));
  const secondCancelled = assert.rejects(second, error => error.name === 'AbortError');
  const third = lanes.run('one', signal, () => order.push('third'));
  await lanes.run('two', signal, () => order.push('independent'));
  assert.deepEqual(order, ['first', 'independent']);
  cancelled.abort();
  await secondCancelled;
  assert.deepEqual(order, ['first', 'independent']);
  release();
  await Promise.all([firstFailed, third]);
  assert.deepEqual(order, ['first', 'independent', 'third']);
});

function memoryStore() {
  const values = new Map();
  return {
    read: async key => values.get(key) ?? null,
    set: async (key, value) => { if (value === null) values.delete(key); else values.set(key, value); },
    scan: async prefix => Object.fromEntries([...values].filter(([key]) => key.startsWith(prefix))),
  };
}

test('saved cursor resumes only its matching session and configuration; uncertain runs are discarded', async () => {
  const store = new SessionStore(memoryStore());
  const key = sessionKey({ key: 'one', relay: 'relay' }, { key: 'channel' });
  const value = { id, cursor: 'opaque cursor', fingerprint: 'configuration' };
  await store.put(key, value);
  assert.deepEqual(await store.get(key, 'configuration'), value);
  assert.equal(await store.get(key, 'changed configuration'), undefined);
  await store.put(key, { ...value, inFlight: true });
  assert.equal(await store.get(key, 'configuration'), undefined);
  await store.put(key, { ...value, id: 'not-a-session' });
  assert.equal(await store.get(key, 'configuration'), undefined);
});

test('retiring one membership preserves other memberships and relays', async () => {
  const store = new SessionStore(memoryStore());
  const first = sessionKey({ key: 'one', relay: 'relay1' }, { key: 'channel' });
  const second = sessionKey({ key: 'two', relay: 'relay2' }, { key: 'channel' });
  const value = { id, cursor: 'cursor', fingerprint: 'config' };
  await store.put(first, value);
  await store.put(second, value);
  await store.clear('one');
  assert.equal(await store.get(first, 'config'), undefined);
  assert.deepEqual(await store.get(second, 'config'), value);
});

test('diagnostic redaction does not repeat OAuth tokens or bearer headers', () => {
  assert.equal(safeMessage(new Error('Bad sk-ant-oat01-sensitive Bearer private-value')), 'Bad [redacted] Bearer [redacted]');
});

test('any successful Buzz send suppresses missing, matching and different final replies', () => {
  const posted = new Set(['Working on it…']);
  for (const text of [undefined, '', 'Working on it…', 'The answer is 42.']) {
    assert.equal(finalReply(text, posted), undefined);
  }
  assert.equal(finalReply('The answer is 42.', new Set()), 'The answer is 42.');
});

test('consumer exceptions retain their identity instead of becoming malformed JSON', () => {
  const failure = new Error('Activity callback failed');
  const parser = new JsonLines(() => { throw failure; });
  assert.throws(() => parser.push('{"type":"assistant"}\n'), error => error === failure);
});

test('terminal errors retain subtype, safe result text and normalized permission denials', () => {
  const output = new TurnOutput();
  output.accept(result({
    is_error: true, subtype: 'error_max_turns',
    result: 'Turn limit reached; sk-ant-oat01-private',
    permission_denials: [{ tool_name: 'Bash' }, { tool_name: 'mcp__buzz__send' }],
  }));
  assert.throws(() => output.finish(1), error => {
    assert.match(error.message, /error_max_turns; exit 1/);
    assert.match(error.message, /Turn limit reached; \[redacted\]/);
    assert.match(error.message, /Permission denied: Bash, send/);
    assert.doesNotMatch(error.message, /sk-ant-/);
    return true;
  });
});

test('one tool call reports only its complete assistant event and strips MCP prefixes', () => {
  const steps = [];
  const output = new TurnOutput(tool => steps.push(tool));
  const block = { type: 'tool_use', name: 'mcp__buzz__send' };
  output.accept({ type: 'stream_event', event: { type: 'content_block_start', content_block: block } });
  output.accept({ type: 'assistant', message: { content: [block] } });
  assert.deepEqual(steps, ['send']);
});

test('early malformed stdout and consumer failures survive delayed spawn resolution', async () => {
  for (const consumerFails of [false, true]) {
    let killed = 0;
    let written = false;
    const host = { spawn: async (_, options) => {
      options.onStdout(consumerFails ? '{"type":"assistant"}\n' : 'not JSON\n');
      return {
        kill: async () => { killed++; }, write: async () => { written = true; },
        end: async () => {}, exited: Promise.resolve(0),
      };
    } };
    await assert.rejects(bridgeRequest(host, '', { action: 'status' }, {
      onEvent: () => { throw new Error('Consumer broke'); },
    }), consumerFails ? /Consumer broke/ : /invalid stream JSON/);
    assert.equal(written, false);
    assert.equal(killed, 1);
  }
});

test('host spawn failures preserve actionable sanitized rejection details', async () => {
  await assert.rejects(bridgeRequest({
    spawn: async () => { throw new Error('Process grant denied; Bearer private-value'); },
  }, '', { action: 'status' }), error => {
    assert.match(error.message, /Process grant denied; Bearer \[redacted\]/);
    assert.doesNotMatch(error.message, /private-value/);
    return true;
  });
});

test('host receives intact large Unicode JSON and a sanitized bridge environment', async () => {
  const prompt = '日本語🌍'.repeat(300000);
  const received = [];
  let environment;
  const code = await bridgeRequest({ spawn: async (_, options) => {
    environment = options.env;
    return {
      write: async data => received.push(data),
      end: async () => options.onStdout('{"type":"bridge_status","tokenStored":false}\n'),
      exited: Promise.resolve(0), kill: async () => {},
    };
  } }, '', { action: 'run', prompt });
  assert.equal(code, 0);
  assert.equal(JSON.parse(received.join('')).prompt, prompt);
  assert.equal(environment.NODE_OPTIONS, null);
  assert.equal(environment.NODE_PATH, null);
  assert.equal(environment.LD_PRELOAD, null);
  assert.equal(environment.DYLD_INSERT_LIBRARIES, null);
});

test('session retention caps each membership by timestamp without evicting another', async () => {
  const storage = memoryStore();
  const store = new SessionStore(storage);
  const key = (member, index) => sessionKey({ key: member, relay: 'relay' }, { key: `thread-${index}` });
  const value = { id, cursor: 'cursor', fingerprint: 'config' };
  await store.put(key('other', 0), { ...value, at: 0 });
  await Promise.all(Array.from({ length: 201 }, (_, at) => store.put(key('member', at), { ...value, at })));
  assert.equal(await store.get(key('member', 0), 'config'), undefined);
  assert.equal((await store.get(key('member', 1), 'config')).at, 1);
  assert.equal((await store.get(key('member', 200), 'config')).at, 200);
  assert.equal((await store.get(key('other', 0), 'config')).at, 0);
  assert.equal(Object.keys(await storage.scan('')).length, 201);
});

test('only explicit removed memberships in ready snapshots can be pruned', async () => {
  const store = new SessionStore(memoryStore());
  const key = member => sessionKey({ key: member, relay: 'relay' }, { key: 'thread' });
  const value = { id, cursor: 'cursor', fingerprint: 'config' };
  await store.put(key('removed'), value);
  await store.put(key('offline'), value);
  await store.prune({ status: 'loading', agents: [{ key: 'removed', deleting: true }] });
  assert.deepEqual(await store.get(key('removed'), 'config'), value);
  await store.prune({ status: 'ready', agents: [{ key: 'removed', deleting: true }], running: [] });
  assert.equal(await store.get(key('removed'), 'config'), undefined);
  assert.deepEqual(await store.get(key('offline'), 'config'), value);
});

test('long terminal details remain bounded without hiding permission denials', () => {
  const output = new TurnOutput();
  output.accept(result({
    is_error: true, subtype: 'error_max_turns',
    result: `Usage limit reached. ${'detail '.repeat(1000)}`,
    permission_denials: [{ tool_name: 'Bash' }],
  }));
  assert.throws(() => output.finish(1), error => {
    const message = safeMessage(error);
    assert.match(message, /error_max_turns/);
    assert.match(message, /Usage limit reached/);
    assert.match(message, /Permission denied: Bash/);
    assert.ok(message.length < 1500);
    return true;
  });
});
