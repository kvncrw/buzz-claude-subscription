import { bridgeRequest, safeMessage } from './session.mjs';

export function createSetup(host, source) {
  const listeners = new Set();
  const controllers = new Set();
  const pending = new Map();
  const cache = new Map();
  let epoch = 0;
  let checking;
  let disposed = false;
  let credentialBusy = false;
  let state = {
    revision: 0, status: undefined, error: '',
    connection: { readiness: 'checking', attentionDescription: 'Checking local Claude subscription setup…' },
  };
  const update = change => {
    if (disposed) return;
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };

  async function inspect(binary = '') {
    binary = binary.trim();
    const generation = epoch;
    if (cache.has(binary)) return cache.get(binary);
    const existing = pending.get(binary);
    if (existing) {
      if (existing.epoch === generation) {
        const answer = await existing.done;
        return generation === epoch ? answer : inspect(binary);
      }
      await existing.done.catch(() => {});
      return inspect(binary);
    }
    if (disposed) throw new Error('Subscription setup is closed.');
    const controller = new AbortController();
    controllers.add(controller);
    const operation = { epoch: generation };
    operation.done = (async () => {
      let answer;
      const code = await bridgeRequest(host, source, { action: 'status', ...(binary ? { binary } : {}) }, {
        signal: controller.signal,
        onEvent: event => { if (event.type === 'bridge_status') answer = event; },
      });
      if (code !== 0 || !answer) throw new Error('The subscription bridge did not return installation status. Check Node.js 20+, the OS credential store and Claude Code.');
      if (generation === epoch) cache.set(binary, answer);
      return answer;
    })().finally(() => {
      controllers.delete(controller);
      if (pending.get(binary) === operation) pending.delete(binary);
    });
    pending.set(binary, operation);
    const answer = await operation.done;
    return generation === epoch ? answer : inspect(binary);
  }

  function check() {
    if (checking) return checking;
    update({ connection: { ...state.connection, readiness: 'checking' } });
    checking = inspect().then(status => {
      const error = [status.credentialError, status.cliError].filter(Boolean).map(safeMessage).join(' ');
      const ready = Boolean(status.tokenStored && status.binary && status.version && !error);
      update({ status, error, revision: state.revision + 1, connection: {
        readiness: ready ? 'ready' : 'attention', blocking: credentialBusy,
        attentionLabel: 'Set up subscription',
        attentionDescription: error || (!status.tokenStored ? 'Save your Claude subscription token.'
          : !ready ? 'Install Claude Code or select its executable in the agent settings.'
            : `Claude ${status.version}; subscription token configured (not remotely validated).`),
      } });
    }, error => update({
      status: undefined, error: safeMessage(error), revision: state.revision + 1,
      connection: { readiness: 'attention', blocking: credentialBusy, attentionLabel: 'Fix subscription setup', attentionDescription: safeMessage(error) },
    })).finally(() => { checking = undefined; });
    return checking;
  }

  async function refresh() {
    // A mutation must never reuse the check that began before it completed.
    await checking;
    epoch++;
    cache.clear();
    await check();
  }

  async function change(action, token, signal) {
    if (credentialBusy) throw new Error('A credential change is already in progress.');
    if (disposed) throw new Error('Subscription setup is closed.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    controllers.add(controller);
    credentialBusy = true;
    update({ connection: { ...state.connection, blocking: true } });
    try {
      let saved;
      const code = await bridgeRequest(host, source, { action, ...(action === 'save' ? { token: token.trim() } : {}) }, {
        signal: controller.signal, onEvent: event => { if (event.type === 'bridge_saved') saved = event; },
      });
      if (code !== 0 || !saved) throw new Error('The credential store did not confirm this change. Check status before trying again.');
      await refresh();
      return saved;
    } finally {
      signal?.removeEventListener('abort', abort);
      controllers.delete(controller);
      credentialBusy = false;
      update({ connection: { ...state.connection, blocking: false } });
    }
  }

  return {
    inspect, check, refresh, change,
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      listeners.clear();
    },
  };
}
