import bridgeSource from './bridge-cli.mjs?source';
import { bridgeRequest, SessionLanes, SessionStore, sessionKey, TurnOutput, safeMessage, abortError, finalReply } from './session.mjs';

export const inject = ['react', 'agents', 'settingsCards', 'host'];

export function apply(ctx) {
  const React = ctx.react;
  const kit = ctx.agents.harness;
  if (!kit || !ctx.agents.storage) throw new Error('Claude subscription requires Buzz 1.0.2 with the external harness kit and agent storage.');
  const store = new SessionStore(ctx.agents.storage);
  const lanes = new SessionLanes();
  const active = new Set();
  const listeners = new Set();
  let disposed = false;
  let connection = { readiness: 'checking', attentionDescription: 'Checking local Claude subscription setup…' };
  let status;
  let statusError = '';
  let checking;
  let credentialBusy = false;
  const notify = () => { for (const listener of listeners) listener(); };
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const defaults = () => ({ model: 'sonnet', cwd: '~/.buzz/claude-subscription-workspace', permissionMode: 'default', instructions: '', scope: 'thread', binary: '' });
  const configOf = config => ({ ...defaults(), ...config });

  async function inspect(binary = '', signal) {
    let answer;
    const code = await bridgeRequest(ctx.host, bridgeSource, { action: 'status', ...(binary ? { binary } : {}) }, {
      signal, onEvent: event => { if (event.type === 'bridge_status') answer = event; },
    });
    if (code !== 0 || !answer) throw new Error('The subscription bridge did not return installation status. Check Node.js 20+, the OS credential store and Claude Code.');
    return answer;
  }
  function check() {
    if (checking) return checking;
    const controller = new AbortController();
    const operation = { controller };
    active.add(operation);
    connection = { readiness: 'checking', attentionDescription: 'Checking local setup…' };
    notify();
    checking = inspect('', controller.signal).then(value => {
      status = value;
      statusError = '';
      connection = { readiness: value.tokenStored && value.binary && value.version ? 'ready' : 'attention', attentionLabel: 'Set up subscription', attentionDescription: !value.tokenStored ? 'Save your Claude subscription token.' : !value.binary || !value.version ? 'Install Claude Code or select its binary in the agent settings.' : `Claude ${value.version}; subscription token configured (not remotely validated).` };
    }, error => {
      status = undefined;
      statusError = safeMessage(error);
      connection = { readiness: 'attention', attentionLabel: 'Fix subscription setup', attentionDescription: statusError };
    }).finally(() => { active.delete(operation); checking = undefined; if (!disposed) notify(); });
    return checking;
  }

  function Connection({ active: isActive = () => true }) {
    React.useSyncExternalStore(subscribe, () => connection);
    const [token, setToken] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [confirmRemove, setConfirmRemove] = React.useState(false);
    const controller = React.useRef();
    React.useEffect(() => { void check(); return () => controller.current?.abort(); }, []);
    async function change(action) {
      if (!isActive() || busy || credentialBusy) return;
      const request = { action, ...(action === 'save' ? { token: token.trim() } : {}) };
      setToken('');
      setConfirmRemove(false);
      setMessage('');
      setBusy(true);
      credentialBusy = true;
      connection = { ...connection, blocking: true };
      notify();
      const cancel = new AbortController();
      controller.current = cancel;
      const operation = { controller: cancel };
      active.add(operation);
      try {
        let saved;
        const code = await bridgeRequest(ctx.host, bridgeSource, request, { signal: cancel.signal, onEvent: event => { if (event.type === 'bridge_saved') saved = event; } });
        if (code !== 0 || !saved) throw new Error('The credential store did not confirm this change. Check status before trying again.');
        setMessage(saved.tokenStored ? 'Token saved in the operating system credential store.' : 'Stored token removed. Already running turns may still finish.');
        await check();
      } catch (error) {
        setMessage(cancel.signal.aborted ? 'Operation cancelled. Check status to determine whether the credential change completed.' : safeMessage(error));
      } finally {
        active.delete(operation); controller.current = undefined; setBusy(false);
        credentialBusy = false; connection = { ...connection, blocking: false };
        if (!disposed) notify();
      }
    }
    return <section className="ui-card" style={{ padding: 20, display: 'grid', gap: 12 }}>
      <h2>Claude Code (subscription)</h2>
      <p>Uses your Claude subscription, not an Anthropic API key or Buzz's built-in Claude sign-in.</p>
      <dl><dt>Claude binary</dt><dd>{status?.binary || 'Not detected'}</dd><dt>Version</dt><dd>{status?.version || 'Not detected'}</dd><dt>Subscription token</dt><dd>{status ? (status.tokenStored ? 'Configured; validity checked when a turn runs' : 'Not configured') : 'Unknown'}</dd></dl>
      <p role={statusError ? 'alert' : 'status'}>{statusError || connection.attentionDescription}</p>
      <p>Install Node.js 20+ and Claude Code on the same system as Buzz, then restart Buzz so its desktop PATH includes node. Linux and WSL require secret-tool and an unlocked Secret Service session; macOS uses Keychain; Windows uses the bridge's Windows credential store. WSL and Windows installations keep separate credentials.</p>
      <label>Subscription token<input type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={event => setToken(event.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <p>Paste only here, never in chat. The field clears on Save, even if saving fails. The token is passed through private process stdin and never saved in agent settings, browser storage or command arguments.</p>
      <div><button disabled={busy || !token.trim()} onClick={() => void change('save')}>{status?.tokenStored ? 'Replace token' : 'Save token'}</button>{' '}<button disabled={busy || connection.readiness === 'checking'} onClick={() => void check()}>Check status</button>{' '}<button disabled={busy || !status?.tokenStored} onClick={() => setConfirmRemove(true)}>Remove token…</button>{' '}{busy && <button onClick={() => controller.current?.abort()}>Cancel</button>}</div>
      {confirmRemove && <div role="alert"><p>Remove the saved subscription token from this device? Future turns will not run until you save another token.</p><button onClick={() => void change('remove')}>Confirm removal</button>{' '}<button onClick={() => setConfirmRemove(false)}>Keep token</button></div>}
      {message && <p role="status">{message}</p>}
      <p>Claude's standard tool permissions are not an OS sandbox. This trusted plugin, Claude and approved tools can access this account's files and network. No Buzz protection capability or permission bypass is enabled.</p>
    </section>;
  }

  function Fields({ config, onChange, disabled }) {
    const value = configOf(config);
    const field = (name, next) => onChange({ ...value, [name]: next });
    return <fieldset disabled={disabled} style={{ display: 'grid', gap: 12 }}>
      <label>Model alias or ID<input value={value.model} placeholder="sonnet, opus, haiku, or a full Claude model ID" onChange={event => field('model', event.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <label>Working folder<input value={value.cwd} onChange={event => field('cwd', event.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <p>Use an absolute path or ~/… on the system running Buzz. The default folder is created automatically; a custom folder must already exist. This is a working directory, not filesystem containment.</p>
      <label>Claude executable (optional)<input value={value.binary} placeholder="Auto-detect, or absolute path to Claude" onChange={event => field('binary', event.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <label>Permissions<select value={value.permissionMode} onChange={event => field('permissionMode', event.target.value)}><option value="default">Default — standard Claude permissions</option><option value="acceptEdits">Accept edits — automatically approve file edits</option></select></label>
      <p>Buzz MCP tools are explicitly allowed. Other actions follow Claude's standard permissions. Requests needing interactive approval are denied, not silently approved. Accept edits authorizes file changes; it does not authorize every shell command. Neither mode provides an OS sandbox.</p>
      <label>Conversation sessions<select value={value.scope} onChange={event => field('scope', event.target.value)}><option value="thread">One per thread (DMs and Solo chats stay whole)</option><option value="channel">One per channel</option></select></label>
      <label>Agent instructions<textarea value={value.instructions} onChange={event => field('instructions', event.target.value)} rows={6} style={{ display: 'block', width: '100%' }} /></label>
    </fieldset>;
  }

  function Create(props) {
    React.useSyncExternalStore(subscribe, () => connection);
    // Executable overrides may be valid even when automatic detection is not.
    const [ready, setReady] = React.useState(false);
    const [problem, setProblem] = React.useState('');
    React.useEffect(() => {
      const cancel = new AbortController();
      setReady(false); setProblem('');
      void inspect(configOf(props.config).binary, cancel.signal).then(value => { if (!cancel.signal.aborted) setReady(Boolean(value.tokenStored && value.binary && value.version)); }, error => { if (!cancel.signal.aborted) setProblem(safeMessage(error)); });
      return () => cancel.abort();
    }, [props.config.binary, connection]);
    React.useEffect(() => { props.onReadyChange?.(ready); }, [ready, props.onReadyChange]);
    return <div>{props.harnessControl}<Fields {...props} /><p role={problem ? 'alert' : 'status'}>{problem || (ready ? 'Subscription setup is ready.' : 'Configure the subscription token in Settings → Claude Code (subscription), and check the executable.')}</p></div>;
  }

  async function retire(key) {
    const pending = [...active].filter(operation => operation.agentKey === key);
    for (const operation of pending) operation.controller.abort();
    await Promise.all(pending.map(operation => operation.done).filter(Boolean));
    await store.clear(key);
  }

  function Settings({ agent, save, settingsHost, settingsContent }) {
    const [draft, setDraft] = React.useState(() => configOf(agent.config));
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [confirmReset, setConfirmReset] = React.useState(false);
    async function commit() {
      setBusy(true); setMessage('');
      try {
        if (settingsHost?.pendingSave) await settingsHost.pendingSave(draft);
        else await save(draft);
        await retire(agent.key); setMessage('Settings saved. The next turn starts a new session with conversation history.'); }
      catch (error) { setMessage(safeMessage(error)); }
      finally { setBusy(false); }
    }
    async function reset() {
      setBusy(true); setMessage('');
      try { await retire(agent.key); setConfirmReset(false); setMessage('Saved conversation associations cleared. Claude transcript files are not deleted.'); }
      catch (error) { setMessage(safeMessage(error)); }
      finally { setBusy(false); }
    }
    return <section style={{ display: 'grid', gap: 12 }}>{settingsContent}{settingsHost?.typeControl?.(JSON.stringify(draft) !== JSON.stringify(configOf(agent.config)))}<Fields config={draft} onChange={setDraft} disabled={busy} /><button disabled={busy || !draft.cwd.trim() || !draft.model.trim()} onClick={() => void commit()}>Save settings</button><button disabled={busy} onClick={() => setConfirmReset(true)}>Reset saved conversations…</button>{confirmReset && <div role="alert"><p>Stop this agent's active turns and forget its session associations? The next turn receives full Buzz conversation history; previous tool actions are not undone.</p><button disabled={busy} onClick={() => void reset()}>Confirm reset</button>{' '}<button onClick={() => setConfirmReset(false)}>Cancel</button></div>}{message && <p role="status">{message}</p>}</section>;
  }

  async function perform(delivery, conversation, signal) {
    const config = configOf(delivery.config);
    const key = sessionKey(delivery.agent, conversation);
    let prompt;
    let sent = false;
    let server;
    const current = () => {
      signal.throwIfAborted();
      if (disposed || !delivery.current()) throw abortError();
    };
    try {
      current();
      if (!ctx.host.resolveDirectory || !ctx.host.readFile || !ctx.host.serveMcp) throw new Error('This harness requires Buzz desktop file and MCP access. Review the plugin host grants.');
      if (!['default', 'acceptEdits'].includes(config.permissionMode)) throw new Error('Unsupported permissions setting. Select Default or Accept edits in this agent’s Settings.');
      const cwd = await ctx.host.resolveDirectory(config.cwd.trim(), { create: config.cwd === defaults().cwd });
      current();
      const systemPrompt = await kit.systemPrompt(delivery, { scope: config.scope, cwd, instructions: config.instructions, tools: true });
      current();
      const settingsBytes = new TextEncoder().encode(JSON.stringify([cwd, config.binary, delivery.model || config.model, config.permissionMode, config.scope, systemPrompt]));
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', settingsBytes));
      const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      const previous = await store.get(key, fingerprint);
      current();
      prompt = await kit.turnPrompt(delivery, conversation, previous ? { cursor: previous.cursor } : {});
      current();
      const id = previous?.id || crypto.randomUUID();
      const postedTexts = new Set();
      let finalPosted = false;
      // Observe actual successful publication, not a model's attempted tool call.
      const agent = { ...delivery.agent, publish: async event => {
        current();
        const result = await delivery.agent.publish(event);
        if (event.kind === 9 && event.tags?.some(tag => tag[0] === 'h' && tag[1] === conversation.channel)) postedTexts.add((event.content || '').trim());
        return result;
      } };
      const tools = kit.tools(agent, conversation, { read: async path => { current(); const bytes = await ctx.host.readFile(path, { cwd }); current(); return bytes; } });
      server = await ctx.host.serveMcp(async message => {
        current();
        if (message?.method === 'tools/call') delivery.step?.(message.params?.name || 'Buzz tool');
        const response = await tools(message);
        const name = message?.params?.name;
        if (message?.method === 'tools/call' && ['send', 'reply_in_subthread'].includes(name) && message.params.arguments?.final === true && !response?.error && !response?.result?.isError && postedTexts.size) finalPosted = true;
        return response;
      });
      current();
      // A crash/stop cannot leave a trusted cursor pointing at uncertain model state.
      await store.put(key, { id, cursor: prompt.cursor, fingerprint, inFlight: true, channelId: conversation.channel, root: conversation.root });
      current();
      const output = new TurnOutput(tool => delivery.step?.(tool));
      const code = await bridgeRequest(ctx.host, bridgeSource, {
        action: 'run', binary: config.binary || undefined, model: delivery.model || config.model,
        prompt: prompt.text, systemPrompt, sessionId: id, resume: Boolean(previous),
        mcp: { url: server.url, headers: server.headers }, permissionMode: config.permissionMode, cwd,
      }, { signal, onEvent: event => output.accept(event), onSent: () => { sent = true; } });
      current();
      const result = output.finish(code, signal.aborted);
      if (result.sessionId !== id) throw new Error('Claude returned an unexpected session identity. The saved association has been cleared to prevent mixing conversations.');
      const answer = finalReply(result.text, postedTexts, finalPosted);
      if (answer) { current(); await kit.reply(delivery.agent, conversation, answer); }
      if (result.denials.length) {
        current();
        await kit.reply(delivery.agent, conversation, `Claude permission denied: ${result.denials.join(', ')}. This headless harness cannot answer interactive approvals. Review the requested action and the agent's permission setting; no permission bypass is enabled.`, { notifyOwner: true });
      } else if (!postedTexts.size && !result.text?.trim()) {
        throw new Error('Claude finished without a reply or a successful Buzz message. Ask again with a specific request.');
      }
      current();
      await store.put(key, { id, cursor: prompt.cursor, fingerprint, channelId: conversation.channel, root: conversation.root, at: Date.now() });
    } catch (error) {
      await store.remove(key);
      if (!sent) prompt?.restore();
      throw error;
    } finally {
      if (server) await server.close();
    }
  }

  async function run(delivery) {
    const conversation = await kit.conversation(delivery, configOf(delivery.config).scope);
    if (!conversation) { delivery.ignored?.(); return; }
    delivery.signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    delivery.signal.addEventListener('abort', abort, { once: true });
    if (delivery.signal.aborted || disposed) controller.abort();
    const operation = { controller, agentKey: delivery.agent.key };
    active.add(operation);
    delivery.acknowledged?.();
    const done = lanes.run(sessionKey(delivery.agent, conversation), controller.signal, () => perform(delivery, conversation, controller.signal)).then(
      () => ({ ok: true }),
      async error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return { ok: true, stopped: true };
        const message = safeMessage(error);
        try { await kit.reply(delivery.agent, conversation, `Claude subscription: ${message}`, { notifyOwner: true }); }
        catch (replyError) { return { ok: false, error: `${message} The error reply also failed: ${safeMessage(replyError)}` }; }
        return { ok: false, error: message };
      },
    ).finally(() => { delivery.signal.removeEventListener('abort', abort); active.delete(operation); });
    operation.done = done;
    delivery.interruptible?.(async () => { controller.abort(); await done; });
    delivery.workingUntil(done);
  }

  ctx.settingsCards.register({ id: 'subscription', title: 'Claude Code (subscription)', personal: true, component: Connection });
  ctx.agents.register({
    id: 'claude-subscription', title: 'Claude Code (subscription)',
    description: 'Your Claude subscription through an independent local CLI harness.',
    defaults: () => ({ config: defaults() }),
    summary: agent => `${configOf(agent.config).model} · subscription`,
    CreateConfiguration: Create,
    tabs: [{ id: 'settings', title: 'Settings', role: 'settings', component: Settings }],
    provider: { snapshot: () => connection, subscribe, check, DialogBody: Connection },
    models: agent => ({ current: configOf(agent.config).model, models: [...new Set([configOf(agent.config).model, 'sonnet', 'opus', 'haiku'])].map(id => ({ id, label: id, efforts: [] })) }),
    protectionUnavailable: 'Standard Claude tool permissions only; this harness does not implement Buzz protection or OS sandboxing.',
    retire, timeoutMs: 30 * 60 * 1000, run,
  });
  ctx.effect(() => {
    void check();
    return () => { disposed = true; for (const operation of active) operation.controller.abort(); listeners.clear(); };
  });
}
