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
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      this.accept(value);
    } catch {
      this.error = new Error('Claude returned invalid stream JSON. Update Claude Code and try again.');
    }
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
        for (const block of content) if (block.type === 'tool_use') this.step(block.name || 'Tool');
      }
    }
    if (event.type === 'stream_event' && event.event?.type === 'content_block_start') {
      const block = event.event.content_block;
      if (block?.type === 'tool_use') this.step(block.name || 'Tool');
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
    const denials = [...new Set(denied.map(item => typeof item.tool_name === 'string' ? item.tool_name : 'a tool'))];
    if (this.result.is_error || code !== 0) {
      const permissions = denials.length ? ` Permission denied: ${denials.join(', ')}. This harness cannot answer interactive approvals.` : '';
      throw new Error(`Claude could not complete this turn (${this.result.subtype || 'process error'}). Check subscription access, usage limits and the selected model; then try again.${permissions}`);
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
    const result = prior.catch(() => {}).then(() => {
      if (signal.aborted) throw abortError();
      return action();
    });
    const settled = result.then(() => {}, () => {});
    this.lanes.set(key, settled);
    void settled.then(() => { if (this.lanes.get(key) === settled) this.lanes.delete(key); });
    return result;
  }
}

export async function bridgeRequest(host, source, request, { signal, onEvent = () => {}, onSent = () => {} } = {}) {
  if (!host.spawn) throw new Error('Buzz desktop process access is unavailable. Install this plugin in Buzz desktop with the Node process grant.');
  signal?.throwIfAborted();
  let process;
  let failure;
  let stopped = false;
  const parser = new JsonLines(event => {
    if (event.type === 'bridge_error') failure = new Error(safeMessage(event.message));
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
        onStdout: chunk => {
          parser.push(chunk);
          if (parser.error) { failure = parser.error; stop(); }
        },
        // Never render unstructured stderr; it can contain credentials.
        onStderr: () => {},
      });
    } catch {
      throw new Error('Cannot start the Node bridge. Install Node.js 20 or newer on the same system as Buzz and make node available on the desktop application PATH; restart Buzz. Also check the plugin process grant.');
    }
    if (stopped || signal?.aborted) { await process.kill().catch(() => {}); throw abortError(); }
    for (const chunk of jsonChunks(JSON.stringify(request))) {
      signal?.throwIfAborted();
      await process.write(chunk);
    }
    // Drop our temporary reference as soon as the host accepts the write.
    if (request.action === 'save') delete request.token;
    await process.end();
    onSent();
    const code = await process.exited;
    if (signal?.aborted) throw abortError();
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
  constructor(storage) { this.storage = storage; }
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
  put(key, value) { return this.storage.set(PREFIX + key, JSON.stringify(value)); }
  remove(key) { return this.storage.set(PREFIX + key, null); }
  async clear(agentKey) {
    const entries = await this.storage.scan(PREFIX);
    for (const storedKey of Object.keys(entries)) {
      let identity;
      try { identity = JSON.parse(storedKey.slice(PREFIX.length)); } catch { continue; }
      if (identity[0] === agentKey) await this.storage.set(storedKey, null);
    }
  }
}

// A progress post must not hide a later answer; an explicit final MCP reply does.
export function finalReply(text, postedTexts, finalPosted) {
  if (typeof text !== 'string' || !text.trim() || finalPosted) return undefined;
  return postedTexts.has(text.trim()) ? undefined : text;
}

// Host IPC limits each write; do not split a Unicode surrogate pair at a boundary.
export function* jsonChunks(json) {
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + 32 * 1024, json.length);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield json.slice(start, end);
    start = end;
  }
}
