// Original MIT implementation. No credentials belong in this module's saved state.
export function sessionKey(agent, conversation) {
  return JSON.stringify([agent.key, agent.relay, conversation.key]);
}

export function abortError() {
  return new DOMException('Claude turn stopped.', 'AbortError');
}

export function safeMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1500);
}

export class JsonLines {
  constructor(accept, maxLine = 8 * 1024 * 1024) {
    this.accept = accept;
    this.maxLine = maxLine;
    this.buffer = '';
    this.error = undefined;
  }
  push(chunk) {
    if (this.error) return;
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line);
      if (this.error) return;
    }
    if (this.buffer.length > this.maxLine) this.error = new Error('Claude output exceeded the protocol line limit.');
  }
  line(line) {
    if (!line.trim()) return;
    if (line.length > this.maxLine) {
      this.error = new Error('Claude output exceeded the protocol line limit.');
      return;
    }
    let value;
    try {
      value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    } catch {
      this.error = new Error('Claude returned invalid stream JSON. Update Claude Code and try again.');
      return;
    }
    // Consumer failures are not JSON framing failures.
    this.accept(value);
  }
  finish() {
    if (!this.error && this.buffer.trim()) this.line(this.buffer);
    this.buffer = '';
    if (this.error) throw this.error;
  }
}

export class TurnOutput {
  constructor(step = () => {}) {
    this.step = step;
    this.result = undefined;
    this.failure = undefined;
    this.lastText = '';
  }
  accept(event) {
    if (event.type === 'bridge_error') this.failure = new Error(safeMessage(event.message || 'Claude bridge failed.'));
    if (event.type === 'assistant') {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        const text = content.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
        if (text) this.lastText = text;
        for (const block of content) if (block.type === 'tool_use') this.step(toolName(block.name));
      }
    }
    if (event.type === 'result') {
      if (this.result) this.failure = new Error('Claude returned multiple terminal results.');
      this.result = event;
    }
  }
  finish(code, cancelled = false) {
    if (cancelled) throw abortError();
    if (this.failure) throw this.failure;
    if (!this.result) throw new Error(`Claude exited without a result (${code ?? 'signal'}). Check the subscription token and Claude installation in Settings.`);
    const denied = Array.isArray(this.result.permission_denials) ? this.result.permission_denials : [];
    const denials = [...new Set(denied.map(item => toolName(item?.tool_name)))];
    if (this.result.is_error || code !== 0) {
      const permissions = denials.length ? ` Permission denied: ${denials.join(', ').slice(0, 300)}. This harness cannot answer interactive approvals.` : '';
      const detail = typeof this.result.result === 'string' ? safeMessage(this.result.result).trim().slice(0, 900) : '';
      const subtype = safeMessage(this.result.subtype || 'process error').slice(0, 100);
      throw new Error(`Claude could not complete this turn (${subtype}; exit ${code ?? 'signal'}).${permissions}${detail ? ` ${detail}` : ''}`);
    }
    return {
      sessionId: this.result.session_id,
      text: typeof this.result.result === 'string' ? this.result.result : this.lastText,
      denials,
    };
  }
}

// Each conversation has one lane. A rejected or cancelled turn cannot poison it.
export class SessionLanes {
  constructor() { this.lanes = new Map(); }
  run(key, signal, action) {
    const prior = this.lanes.get(key) || Promise.resolve();
    let removeAbort = () => {};
    let started = false;
    const cancelled = new Promise((_, reject) => {
      const abort = () => { if (!started) reject(signal.reason || abortError()); };
      signal.addEventListener('abort', abort, { once: true });
      removeAbort = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
    });
    const queued = prior.then(() => {
      signal.throwIfAborted();
      started = true;
      removeAbort();
      return action();
    });
    // Keep the lane behind its predecessor even when its caller cancels early.
    const settled = queued.then(() => {}, () => {});
    this.lanes.set(key, settled);
    void settled.then(() => {
      if (this.lanes.get(key) === settled) this.lanes.delete(key);
    });
    return Promise.race([queued, cancelled]).finally(removeAbort);
  }
}

export async function bridgeRequest(host, source, request, { signal, onEvent = () => {} } = {}) {
  if (!host.spawn) throw new Error('Buzz desktop process access is unavailable. Install this plugin in Buzz desktop with the Node process grant.');
  signal?.throwIfAborted();
  let process;
  let failure;
  let stopped = false;
  const parser = new JsonLines(event => {
    if (event.type === 'bridge_error') failure = new Error(safeMessage(event.message || 'Claude bridge failed.'));
    onEvent(event);
  });
  const stop = () => {
    stopped = true;
    if (process) void process.kill().catch(() => {});
  };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    try {
      process = await host.spawn('bridge', {
        args: ['-e', source],
        // The bridge itself holds credentials, before the native child env exists.
        env: {
          NODE_OPTIONS: null, NODE_PATH: null,
          LD_PRELOAD: null, LD_LIBRARY_PATH: null, LD_AUDIT: null,
          DYLD_INSERT_LIBRARIES: null, DYLD_LIBRARY_PATH: null,
          DYLD_FRAMEWORK_PATH: null, DYLD_FALLBACK_LIBRARY_PATH: null,
          DYLD_FALLBACK_FRAMEWORK_PATH: null, DYLD_ROOT_PATH: null,
          DYLD_IMAGE_SUFFIX: null, DYLD_VERSIONED_LIBRARY_PATH: null,
          DYLD_VERSIONED_FRAMEWORK_PATH: null,
        },
        onStdout: chunk => {
          if (failure) return;
          try {
            parser.push(chunk);
            if (parser.error) throw parser.error;
          } catch (error) {
            failure = error;
            stop();
          }
        },
        // Never render unstructured stderr; it can contain credentials.
        onStderr: () => {},
      });
    } catch (error) {
      if (failure) throw failure;
      throw new Error(`Cannot start the Node bridge: ${safeMessage(error)}. Check Node.js 20+ on the desktop PATH and the plugin process grant.`);
    }
    if (failure) throw failure;
    if (stopped || signal?.aborted) throw signal?.reason || abortError();
    // Buzz queues writes and splits them at UTF-8-safe boundaries.
    await process.write(JSON.stringify(request));
    if (request.action === 'save') delete request.token;
    signal?.throwIfAborted();
    await process.end();
    const code = await process.exited;
    signal?.throwIfAborted();
    if (failure) throw failure;
    parser.finish();
    if (failure) throw failure;
    return code;
  } finally {
    if (request.action === 'save') delete request.token;
    signal?.removeEventListener('abort', stop);
    if (process) await process.kill().catch(() => {});
  }
}

const PREFIX = 'kvncrw.buzz-claude-subscription/session/v1/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class SessionStore {
  constructor(storage) {
    this.storage = storage;
    this.writes = Promise.resolve();
  }
  async get(key, fingerprint) {
    const raw = await this.storage.read(PREFIX + key);
    if (!raw) return undefined;
    let value;
    try { value = JSON.parse(raw); } catch { await this.remove(key); return undefined; }
    if (!UUID.test(value?.id || '') || typeof value.cursor !== 'string' || value.fingerprint !== fingerprint || value.inFlight) {
      await this.remove(key);
      return undefined;
    }
    return value;
  }
  mutate(action) {
    const result = this.writes.then(action);
    this.writes = result.catch(() => {});
    return result;
  }
  put(key, value) {
    return this.mutate(async () => {
      await this.storage.set(PREFIX + key, JSON.stringify(value));
      const agentKey = JSON.parse(key)[0];
      const entries = await this.storage.scan(PREFIX);
      const matching = Object.entries(entries).flatMap(([storedKey, raw]) => {
        try {
          if (JSON.parse(storedKey.slice(PREFIX.length))[0] !== agentKey) return [];
          const saved = JSON.parse(raw);
          return [{ key: storedKey, at: Number.isFinite(saved.at) ? saved.at : 0 }];
        } catch { return []; }
      }).sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
      for (const old of matching.slice(200)) await this.storage.set(old.key, null);
    });
  }
  remove(key) { return this.mutate(() => this.storage.set(PREFIX + key, null)); }
  clear(agentKey) {
    return this.mutate(async () => {
      const entries = await this.storage.scan(PREFIX);
      for (const storedKey of Object.keys(entries)) {
        let identity;
        try { identity = JSON.parse(storedKey.slice(PREFIX.length)); } catch { continue; }
        if (identity[0] === agentKey) await this.storage.set(storedKey, null);
      }
    });
  }
  async prune(snapshot) {
    // "running" is not a complete membership list, even when status is ready:
    // disconnected communities and other accounts are absent. Only explicit
    // removal evidence is safe; never delete associations merely for absence.
    if (snapshot?.status !== 'ready') return;
    const removed = new Set((snapshot.agents || []).filter(agent => agent.deleting).map(agent => agent.key));
    for (const key of removed) await this.clear(key);
  }
}

function toolName(name) {
  return safeMessage(typeof name === 'string' ? name.replace(/^mcp__buzz__/, '') : 'a tool');
}

// Any successful Buzz publication owns the reply; private closing text is not
// a second answer, even when send omitted its optional final flag.
export function finalReply(text, postedTexts) {
  if (postedTexts.size || typeof text !== 'string' || !text.trim()) return undefined;
  return text;
}
