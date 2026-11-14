import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonLines, TurnOutput, SessionLanes, SessionStore, sessionKey, safeMessage, finalReply, jsonChunks } from '../src/session.mjs';

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
  release();
  await Promise.all([firstFailed, secondCancelled, third]);
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

test('final replies are not duplicated, but progress messages do not swallow the answer', () => {
  const posted = new Set(['Working on it…']);
  assert.equal(finalReply('The answer is 42.', posted, false), 'The answer is 42.');
  posted.add('The answer is 42.');
  assert.equal(finalReply('  The answer is 42.  ', posted, false), undefined);
  assert.equal(finalReply('A CLI-only closing summary', posted, true), undefined);
  assert.equal(finalReply('', posted, false), undefined);
});

test('large bridge JSON is bounded per write and preserves non-BMP boundary characters', () => {
  // Place a high surrogate at the last UTF-16 slot of the first nominal chunk.
  const prefix = JSON.stringify({ action: 'run', prompt: '' }).indexOf('"prompt":"') + '"prompt":"'.length;
  const prompt = 'a'.repeat(32767 - prefix) + '🌍' + '日本語🌍'.repeat(300000);
  const wire = JSON.stringify({ action: 'run', prompt });
  assert.ok(Buffer.byteLength(wire, 'utf8') > 1024 * 1024);
  const chunks = [...jsonChunks(wire)];
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk, 'utf8') < 1024 * 1024);
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk));
  }
  assert.equal(chunks.join(''), wire);
  assert.equal(JSON.parse(chunks.join('')).prompt, prompt);
});
