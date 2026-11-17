import { configOf, configReady, defaults, saveSettings } from './runtime.mjs';
import { safeMessage } from './session.mjs';

export function createUI(React, setup, runtime) {
  function Form({ children }) {
    return <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <style>{`
        .kvncrw-claude-control {
          box-sizing: border-box; min-width: 0; padding: 9px 11px;
          border: 1px solid color-mix(in srgb,currentColor 25%,transparent);
          border-radius: 9px; background: color-mix(in srgb,currentColor 5%,transparent);
          color: inherit; font: inherit;
        }
        :is(input,textarea,select).kvncrw-claude-control { display: block; width: 100%; margin-top: 6px; }
        button.kvncrw-claude-control { cursor: pointer; }
        .kvncrw-claude-control:disabled { opacity: .5; cursor: not-allowed; }
        .kvncrw-claude-control:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        .kvncrw-claude-copy { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
      `}</style>
      {children}
    </div>;
  }
  const Button = props => <button className="kvncrw-claude-control" {...props} />;
  const Copy = props => <p className="kvncrw-claude-copy" {...props} />;

  function Connection({ active: isActive = () => true }) {
    const { connection, status, error } = React.useSyncExternalStore(setup.subscribe, setup.snapshot);
    const [token, setToken] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [confirmRemove, setConfirmRemove] = React.useState(false);
    const controller = React.useRef();
    React.useEffect(() => {
      void setup.check();
      return () => controller.current?.abort();
    }, []);
    async function change(action) {
      if (!isActive() || busy || connection.blocking) return;
      const value = token.trim();
      setToken('');
      setConfirmRemove(false);
      setMessage('');
      setBusy(true);
      const cancel = new AbortController();
      controller.current = cancel;
      try {
        const saved = await setup.change(action, value, cancel.signal);
        setMessage(saved.tokenStored
          ? 'Token saved in the operating system credential store.'
          : 'Stored token removed. Already running turns may still finish.');
      } catch (error) {
        setMessage(cancel.signal.aborted
          ? 'Operation cancelled. Check status to determine whether the credential change completed.'
          : safeMessage(error));
      } finally {
        controller.current = undefined;
        setBusy(false);
      }
    }
    return <Form>
      <section className="ui-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <h2>Claude Code (subscription)</h2>
        <Copy>Uses your Claude subscription, not an Anthropic API key or Buzz's built-in Claude sign-in.</Copy>
        <dl style={{ overflowWrap: 'anywhere' }}>
          <dt>Automatically detected Claude binary</dt><dd>{status?.binary || 'Not detected'}</dd>
          <dt>Version</dt><dd>{status?.version || 'Not detected'}</dd>
          <dt>Subscription token</dt>
          <dd>{status ? (status.tokenStored ? 'Configured; validity checked when a turn runs' : 'Not configured') : 'Unknown'}</dd>
        </dl>
        <Copy role={error ? 'alert' : 'status'}>{error || connection.attentionDescription}</Copy>
        <Copy>
          Device status uses automatic executable detection. A custom per-agent executable is checked
          separately when you leave its field. Install Node.js 20+ and Claude Code 2.1.267+ on the same
          system as Buzz, then restart Buzz so its desktop PATH includes node.
        </Copy>
        <Copy>
          Linux and WSL require secret-tool and an unlocked Secret Service session; macOS uses Keychain;
          Windows uses the bridge's Windows credential store. WSL and Windows keep separate credentials.
        </Copy>
        <label>Subscription token
          <input className="kvncrw-claude-control" type="password" autoComplete="off" spellCheck={false}
            value={token} disabled={busy || connection.blocking} onChange={event => setToken(event.target.value)} />
        </label>
        <Copy>
          Paste only here, never in chat. The field clears on Save, even if saving fails. The token travels
          through private process stdin, never agent settings, browser storage or command arguments.
        </Copy>
        <div>
          <Button disabled={busy || connection.blocking || !token.trim()} onClick={() => void change('save')}>
            {status?.tokenStored ? 'Replace token' : 'Save token'}
          </Button>{' '}
          <Button disabled={busy || connection.blocking || connection.readiness === 'checking'} onClick={() => void setup.refresh()}>
            Check status
          </Button>{' '}
          <Button disabled={busy || connection.blocking || !status?.tokenStored} onClick={() => setConfirmRemove(true)}>
            Remove token…
          </Button>{' '}
          {busy && <Button onClick={() => controller.current?.abort()}>Cancel</Button>}
        </div>
        {confirmRemove && <div role="alert">
          <Copy>Remove the saved token from this device? Future turns require another saved token.</Copy>
          <Button onClick={() => void change('remove')}>Confirm removal</Button>{' '}
          <Button onClick={() => setConfirmRemove(false)}>Keep token</Button>
        </div>}
        {message && <Copy role="status">{message}</Copy>}
        <Copy>
          Claude's tool permissions are not an OS sandbox. This trusted plugin, Claude and approved tools
          can access this account's files and network. No Buzz protection or permission bypass is enabled.
        </Copy>
      </section>
    </Form>;
  }

  function Fields({ config, onChange, disabled, onBinaryBlur }) {
    // Preserve the editable draft; trimming happens at readiness/save/run boundaries.
    const value = { ...defaults(), ...config };
    const field = (name, next) => onChange({ ...value, [name]: next });
    return <Form>
      <fieldset disabled={disabled} style={{ display: 'grid', gap: 16 }}>
        <label>Model alias or ID
          <input className="kvncrw-claude-control" value={value.model}
            placeholder="sonnet, opus, haiku, fable, or a full Claude model ID"
            onChange={event => field('model', event.target.value)} />
        </label>
        <label>Working folder
          <input className="kvncrw-claude-control" value={value.cwd} onChange={event => field('cwd', event.target.value)} />
        </label>
        <Copy>
          Use an absolute path or ~/… on the system running Buzz. The default folder is created automatically;
          a custom folder must exist. This is a working directory, not filesystem containment.
        </Copy>
        <label>Claude executable (optional)
          <input className="kvncrw-claude-control" value={value.binary}
            placeholder="Auto-detect, or absolute path to Claude"
            onChange={event => field('binary', event.target.value)} onBlur={onBinaryBlur} />
        </label>
        <label>Permissions
          <select className="kvncrw-claude-control" value={value.permissionMode} onChange={event => field('permissionMode', event.target.value)}>
            <option value="default">Default — standard Claude permissions</option>
            <option value="acceptEdits">Accept edits — automatically approve file edits</option>
          </select>
        </label>
        <Copy>
          Buzz MCP tools are explicitly allowed, including reading and uploading local files. Other actions
          follow Claude's standard permissions. Requests needing interactive approval are denied, not silently
          approved. Accept edits authorizes file changes, not every shell command. Neither mode is an OS sandbox.
        </Copy>
        <label>Allowed tools (optional)
          <input className="kvncrw-claude-control" value={value.allowedTools}
            placeholder="Bash, Read, Edit, Write, Glob, Grep, WebFetch"
            onChange={event => field('allowedTools', event.target.value)} />
        </label>
        <Copy>
          Comma-separated Claude tool names this agent may use without approval, on top of the Buzz MCP tools.
          A specifier narrows one: Bash(git:*). Leave empty to deny everything that needs approval.
        </Copy>
        <label>Conversation sessions
          <select className="kvncrw-claude-control" value={value.scope} onChange={event => field('scope', event.target.value)}>
            <option value="thread">One per thread (DMs and Solo chats stay whole)</option>
            <option value="channel">One per channel</option>
          </select>
        </label>
        <label>Agent instructions
          <textarea className="kvncrw-claude-control" value={value.instructions} rows={6}
            onChange={event => field('instructions', event.target.value)} />
        </label>
      </fieldset>
    </Form>;
  }

  function Create(props) {
    const { revision, connection } = React.useSyncExternalStore(setup.subscribe, setup.snapshot);
    const [binary, setBinary] = React.useState(() => configOf(props.config).binary);
    const [checked, setChecked] = React.useState();
    const [problem, setProblem] = React.useState('');
    React.useEffect(() => {
      let active = true;
      setChecked(undefined);
      setProblem('');
      void setup.inspect(binary).then(value => {
        if (!active) return;
        setChecked({ binary, revision, ready: Boolean(value.tokenStored && value.binary && value.version && !value.credentialError && !value.cliError) });
        setProblem([value.credentialError, value.cliError].filter(Boolean).map(safeMessage).join(' '));
      }, error => { if (active) setProblem(safeMessage(error)); });
      return () => { active = false; };
    }, [binary, revision]);
    const ready = Boolean(checked?.ready && checked.binary === configOf(props.config).binary
      && checked.revision === revision && configReady(props.config) && !connection.blocking);
    React.useEffect(() => { props.onReadyChange?.(ready); }, [ready, props.onReadyChange]);
    return <Form>
      {props.harnessControl}
      <details>
        <summary className="kvncrw-claude-control">Subscription token setup</summary>
        <Connection />
      </details>
      <Fields {...props} onBinaryBlur={() => setBinary(configOf(props.config).binary)} />
      <Copy role={problem ? 'alert' : 'status'}>
        {problem || (ready ? 'Subscription setup is ready.'
          : 'Enter a model and working folder, then leave the executable field to check it. Open Subscription token setup to save a token.')}
      </Copy>
    </Form>;
  }

  function Settings({ agent, save, settingsHost, settingsContent }) {
    const [draft, setDraft] = React.useState(() => configOf(agent.config));
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [confirmReset, setConfirmReset] = React.useState(false);
    async function commit() {
      setBusy(true);
      setMessage('');
      try {
        await saveSettings(save, draft);
        setMessage('Settings saved for future turns. Active turns continue; model and instruction changes preserve conversations.');
      } catch (error) { setMessage(safeMessage(error)); }
      finally { setBusy(false); }
    }
    async function reset() {
      setBusy(true);
      setMessage('');
      try {
        await runtime.retire(agent.key);
        setConfirmReset(false);
        setMessage('Saved conversation associations cleared. Claude transcript files are not deleted.');
      } catch (error) { setMessage(safeMessage(error)); }
      finally { setBusy(false); }
    }
    return <Form>
      {settingsContent}
      {settingsHost?.typeControl?.(JSON.stringify(draft) !== JSON.stringify(configOf(agent.config)))}
      <Fields config={draft} onChange={setDraft} disabled={busy} />
      <Button disabled={busy || !configReady(draft)} onClick={() => void commit()}>Save settings</Button>
      <Button disabled={busy} onClick={() => setConfirmReset(true)}>Reset saved conversations…</Button>
      {confirmReset && <div role="alert">
        <Copy>
          Stop this agent's active turns and forget its session associations? New arrivals are ignored during
          reset. The next turn receives Buzz conversation history; previous tool actions are not undone.
        </Copy>
        <Button disabled={busy} onClick={() => void reset()}>Confirm reset</Button>{' '}
        <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
      </div>}
      {message && <Copy role="status">{message}</Copy>}
    </Form>;
  }
  return { Connection, Create, Settings };
}
