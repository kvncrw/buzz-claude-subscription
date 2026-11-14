import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, defaults, saveSettings, configReady } from '../src/runtime.mjs';
import { createSetup } from '../src/setup.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function storage() {
  const data = new Map();
  return {
    read: async key => data.get(key),
    set: async (key, value) => { if (value === null) data.delete(key); else data.set(key, value); },
    scan: async prefix => Object.fromEntries([...data].filter(([key]) => key.startsWith(prefix))),
  };
}

function fixture(plans = []) {
  const requests = [], publishes = [], prompts = [], systems = [], processes = [];
  let restores = 0;
  let handler;
  const stored = storage();
  const kit = {
    conversation: async () => ({ key: 'conversation', channel: 'channel' }),
    systemPrompt: async (delivery, options) => {
      systems.push(options);
      return `${options.instructions}\n${delivery.team || ''}`;
    },
    turnPrompt: async (_, __, options) => {
      prompts.push(options);
      return { text: 'Prompt with plugin notes', cursor: `cursor-${prompts.length}`, restore: () => { restores++; } };
    },
    tools: agent => async message => {
      if (message.method === 'tools/call') await agent.publish({
        kind: 9, content: message.params.arguments.text,
        tags: [['h', 'channel']],
      });
      return { result: {} };
    },
    reply: async (agent, _, text) => agent.publish({ kind: 9, content: text, tags: [['h', 'channel']] }),
  };
  const host = {
    resolveDirectory: async () => '/workspace',
    readFile: async () => new Uint8Array(),
    serveMcp: async accept => {
      handler = accept;
      return { url: 'http://localhost/mcp', headers: {}, close: async () => {} };
    },
    spawn: async (_, options) => {
      const exit = deferred();
      const process = { killed: 0, request: undefined };
      processes.push(process);
      return {
        write: async data => { process.request = JSON.parse(data); },
        end: async () => {
          const request = process.request;
          requests.push(request);
          const emit = event => options.onStdout(`${JSON.stringify(event)}\n`);
          const finish = (fields = {}, code = 0) => {
            emit({ type: 'result', session_id: request.sessionId, result: 'Final answer', is_error: false, ...fields });
            exit.resolve(code);
          };
          const plan = plans.shift() || (async ({ emit, finish }) => { emit({ type: 'bridge_started' }); finish(); });
          void Promise.resolve().then(() => plan({
            request, emit, finish, exit,
            send: text => handler({ method: 'tools/call', params: { name: 'send', arguments: { text } } }),
          })).catch(exit.reject);
        },
        exited: exit.promise,
        kill: async () => { process.killed++; exit.resolve(null); },
      };
    },
  };
  const ctx = { host, agents: { harness: kit, storage: stored } };
  const runtime = createRuntime(ctx, 'bridge source');
  const delivery = (changes = {}) => {
    const abort = new AbortController();
    const value = {
      trigger: { type: 'mention' }, config: defaults(), signal: abort.signal, current: () => true,
      agent: { key: 'membership', relay: 'relay', publish: async event => { publishes.push(event.content); return 'published'; } },
      workingUntil: done => { value.done = done; },
      interruptible: stop => { value.stop = stop; },
      ignored: () => { value.wasIgnored = true; },
      ...changes,
    };
    value.abort = abort;
    return value;
  };
  const run = value => { runtime.run(value); return value.done; };
  return { runtime, delivery, run, kit, stored, requests, publishes, prompts, systems, processes, restores: () => restores };
}

test('successful send without final suppresses absent and different terminal text', async () => {
  for (const result of [undefined, '', 'I already replied privately.']) {
    const f = fixture([async ({ emit, send, finish }) => {
      emit({ type: 'bridge_started' });
      await send('Published answer');
      finish({ result });
    }]);
    assert.deepEqual(await f.run(f.delivery()), { ok: true });
    assert.deepEqual(f.publishes, ['Published answer']);
    assert.match(f.systems[0].instructions, /final nonempty message WILL be posted/);
  }
});

test('intentional empty attention and plugin wakes succeed but a silent mention fails', async () => {
  for (const type of ['attention', 'plugin', 'mention']) {
    const f = fixture([async ({ emit, finish }) => { emit({ type: 'bridge_started' }); finish({ result: '' }); }]);
    const outcome = await f.run(f.delivery({ trigger: { type } }));
    assert.equal(outcome.ok, type !== 'mention');
    assert.equal(f.publishes.length, type === 'mention' ? 1 : 0);
    if (type === 'mention') assert.match(outcome.error, /without a reply/);
  }
});

test('structured error details survive a nonzero bridge exit', async () => {
  const f = fixture([async ({ emit, finish }) => {
    emit({ type: 'bridge_started' });
    finish({ is_error: true, subtype: 'error_max_turns', result: 'Maximum turn count reached; sk-ant-oat01-private', permission_denials: [{ tool_name: 'Bash' }] }, 1);
  }]);
  const outcome = await f.run(f.delivery());
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /error_max_turns/);
  assert.match(outcome.error, /Maximum turn count reached/);
  assert.match(outcome.error, /Permission denied: Bash/);
  assert.doesNotMatch(f.publishes[0], /sk-ant-/);
});

test('model picks, defaults, permissions and dynamic prompts preserve session and cursor', async () => {
  const f = fixture();
  await f.run(f.delivery());
  await f.run(f.delivery({ model: ' fable ', team: 'Updated memory and team', config: { ...defaults(), instructions: 'New instructions' } }));
  await f.run(f.delivery({ config: { ...defaults(), model: 'opus', permissionMode: 'acceptEdits' } }));
  assert.deepEqual(f.requests.map(request => request.resume), [false, true, true]);
  assert.equal(new Set(f.requests.map(request => request.sessionId)).size, 1);
  assert.deepEqual(f.requests.map(request => request.model), ['sonnet', 'fable', 'opus']);
  assert.deepEqual(f.prompts, [{}, { cursor: 'cursor-1' }, { cursor: 'cursor-2' }]);
  assert.match(f.requests[1].systemPrompt, /Updated memory and team/);
});

test('queued deadlines fail promptly while owner Stop alone reports stopped', async () => {
  const started = deferred(), release = deferred();
  const f = fixture([async ({ emit, finish }) => {
    emit({ type: 'bridge_started' }); started.resolve(); await release.promise; finish();
  }]);
  const first = f.run(f.delivery());
  await started.promise;
  const timed = f.delivery();
  const timedDone = f.run(timed);
  timed.abort.abort();
  const timeout = await timedDone;
  assert.equal(timeout.ok, false);
  assert.match(timeout.error, /deadline/);
  assert.equal(timeout.stopped, undefined);
  assert.equal(f.requests.length, 1);
  const stopped = f.delivery();
  const stoppedDone = f.run(stopped);
  // conversation resolution is asynchronous; let its admission hook run.
  await Promise.resolve();
  await stopped.stop();
  assert.deepEqual(await stoppedDone, { ok: true, stopped: true });
  assert.equal(f.requests.length, 1);
  assert.equal(f.publishes.length, 1);
  release.resolve();
  assert.deepEqual(await first, { ok: true });
});

test('active deadline versus lifetime cancellation have distinct visible outcomes', async () => {
  for (const reason of ['deadline', 'lifetime']) {
    const started = deferred();
    let current = true;
    const f = fixture([async ({ emit }) => { emit({ type: 'bridge_started' }); started.resolve(); }]);
    const delivery = f.delivery({ current: () => current });
    const done = f.run(delivery);
    await started.promise;
    current = reason === 'deadline';
    delivery.abort.abort();
    const outcome = await done;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.stopped, undefined);
    assert.match(outcome.error, reason === 'deadline' ? /deadline/ : /no longer active/);
    assert.equal(f.publishes.length, reason === 'deadline' ? 1 : 0);
  }
});

test('owner Stop cancels an active child without a reply and clears its uncertain cursor', async () => {
  const started = deferred();
  const f = fixture([async ({ emit }) => { emit({ type: 'bridge_started' }); started.resolve(); }]);
  const delivery = f.delivery();
  const done = f.run(delivery);
  await started.promise;
  await delivery.stop();
  assert.deepEqual(await done, { ok: true, stopped: true });
  assert.equal(f.publishes.length, 0);
  assert.deepEqual(await f.stored.scan(''), {});
  assert.equal(f.restores(), 0);
});

test('saving settings never stops a running turn', async () => {
  const started = deferred(), release = deferred();
  const f = fixture([async ({ emit, finish }) => {
    emit({ type: 'bridge_started' }); started.resolve(); await release.promise; finish();
  }]);
  const done = f.run(f.delivery());
  await started.promise;
  let saved;
  await saveSettings(async config => { saved = config; }, { ...defaults(), model: ' fable ', cwd: ' /workspace ', instructions: ' changed ' });
  assert.equal(saved.model, 'fable');
  assert.equal(saved.cwd, '/workspace');
  assert.equal(saved.instructions, 'changed');
  assert.equal(f.processes[0].killed, 0);
  release.resolve();
  assert.deepEqual(await done, { ok: true });
  assert.equal(configReady({ ...defaults(), model: '  ' }), false);
  assert.equal(configReady({ ...defaults(), cwd: '  ' }), false);
});

test('reset blocks arrivals while clearing and cannot resurrect a pre-reset session', async () => {
  const started = deferred(), clearing = deferred(), releaseClear = deferred();
  const f = fixture([async ({ emit }) => { emit({ type: 'bridge_started' }); started.resolve(); }]);
  const originalSet = f.stored.set;
  f.stored.set = async (key, value) => {
    if (value === null) { clearing.resolve(); await releaseClear.promise; }
    await originalSet(key, value);
  };
  const first = f.run(f.delivery());
  await started.promise;
  const reset = f.runtime.retire('membership');
  await clearing.promise;
  const arrival = f.delivery();
  f.run(arrival);
  assert.equal(arrival.wasIgnored, true);
  assert.equal(f.requests.length, 1);
  releaseClear.resolve();
  await reset;
  assert.equal((await first).ok, false);
  assert.deepEqual(await f.stored.scan(''), {});
  assert.deepEqual(await f.run(f.delivery()), { ok: true });
  assert.equal(f.requests[1].resume, false);
  assert.notEqual(f.requests[1].sessionId, f.requests[0].sessionId);
});

test('reset also catches deliveries still resolving their conversation', async () => {
  const conversation = deferred();
  const f = fixture();
  f.kit.conversation = () => conversation.promise;
  const first = f.run(f.delivery());
  const reset = f.runtime.retire('membership');
  conversation.resolve({ key: 'conversation', channel: 'channel' });
  await reset;
  assert.equal((await first).ok, false);
  assert.equal(f.requests.length, 0);
});

test('notes restore only if the native child never emitted its start marker', async () => {
  for (const started of [false, true]) {
    const f = fixture([async ({ emit, exit }) => {
      if (started) emit({ type: 'bridge_started' });
      emit({ type: 'bridge_error', message: 'Unlock the credential store.' });
      exit.resolve(1);
    }]);
    assert.equal((await f.run(f.delivery())).ok, false);
    assert.equal(f.restores(), started ? 0 : 1);
    assert.deepEqual(await f.stored.scan(''), {});
  }
});

function setupFixture() {
  const requests = [], pending = [];
  const host = { spawn: async (_, options) => {
    const exit = deferred();
    let request;
    return {
      write: async data => { request = JSON.parse(data); },
      end: async () => {
        requests.push(request);
        const operation = {
          request,
          finish: event => { options.onStdout(`${JSON.stringify(event)}\n`); exit.resolve(0); },
        };
        pending.push(operation);
        waiter?.resolve(operation);
        waiter = undefined;
      },
      kill: async () => exit.resolve(null), exited: exit.promise,
    };
  } };
  let waiter;
  return {
    setup: createSetup(host, 'source'), requests,
    next: async () => {
      if (pending.length) return pending.shift();
      waiter = deferred();
      await waiter.promise;
      return pending.shift();
    },
  };
}

const status = tokenStored => ({ type: 'bridge_status', tokenStored, binary: '/claude', version: '2.1.323' });

test('mount consumers share status and cache checks instead of spawning per notification', async () => {
  const f = setupFixture();
  const check = f.setup.check();
  const create = f.setup.inspect();
  const connection = f.setup.check();
  (await f.next()).finish(status(true));
  await Promise.all([check, create, connection]);
  for (let index = 0; index < 10; index++) await f.setup.inspect();
  assert.equal(f.requests.length, 1);
  assert.equal(f.setup.snapshot().connection.readiness, 'ready');
});

test('saving during a pre-save check waits it out then obtains fresh status', async () => {
  const f = setupFixture();
  const initial = f.setup.check();
  const oldCheck = await f.next();
  const save = f.setup.change('save', 'fixture-token', new AbortController().signal);
  const mutation = await f.next();
  mutation.finish({ type: 'bridge_saved', tokenStored: true });
  oldCheck.finish(status(false));
  await initial;
  const fresh = await f.next();
  assert.equal(fresh.request.action, 'status');
  fresh.finish(status(true));
  await save;
  assert.equal(f.setup.snapshot().status.tokenStored, true);
  assert.equal(f.setup.snapshot().connection.readiness, 'ready');
  assert.deepEqual(f.requests.map(request => request.action), ['status', 'save', 'status']);
});

test('credential refresh does not reuse an old custom executable probe', async () => {
  const f = setupFixture();
  const old = f.setup.inspect('/custom-claude');
  const custom = await f.next();
  const refresh = f.setup.refresh();
  const automatic = await f.next();
  automatic.finish(status(true));
  await refresh;
  const renewed = f.setup.inspect('/custom-claude');
  custom.finish(status(false));
  const newCustom = await f.next();
  newCustom.finish(status(true));
  assert.equal((await old).tokenStored, true);
  assert.equal((await renewed).tokenStored, true);
  assert.deepEqual(f.requests.map(request => request.binary), ['/custom-claude', undefined, '/custom-claude']);
});

test('setup keeps independent credential and executable failure details actionable', async () => {
  const f = setupFixture();
  const check = f.setup.check();
  (await f.next()).finish({ ...status(false), credentialError: 'Unlock the keyring.', cliError: 'Claude Code 2.1.267 or newer is required.' });
  await check;
  assert.equal(f.setup.snapshot().connection.readiness, 'attention');
  assert.match(f.setup.snapshot().error, /Unlock the keyring/);
  assert.match(f.setup.snapshot().error, /2.1.267/);
});

test('explicit status refresh observes credentials and CLI changes made outside the UI', async () => {
  const f = setupFixture();
  const initial = f.setup.check();
  (await f.next()).finish({ type: 'bridge_status', tokenStored: false, binary: null, version: null });
  await initial;
  assert.equal(f.setup.snapshot().connection.readiness, 'attention');
  const installed = f.setup.refresh();
  (await f.next()).finish(status(true));
  await installed;
  assert.equal(f.setup.snapshot().status.tokenStored, true);
  assert.equal(f.setup.snapshot().connection.readiness, 'ready');
  const removed = f.setup.refresh();
  (await f.next()).finish(status(false));
  await removed;
  assert.equal(f.setup.snapshot().status.tokenStored, false);
  assert.equal(f.setup.snapshot().connection.readiness, 'attention');
  assert.equal(f.requests.length, 3);
});