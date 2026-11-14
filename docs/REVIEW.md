# Claude Code Fable review and resolution

The user-requested full code and adversarial review was performed with **Claude Code 2.1.323 / claude-fable-5-2**. The reviewer had read-only tools and inspected the original implementation plus the pinned Buzz 1.0.2 host contracts. The original report is preserved below; its line numbers and verdict describe the **pre-cleanup implementation**, not the current code.

## Resolution of confirmed findings

| Finding | Current correction |
| --- | --- |
| 1. Private/duplicate final text | Any successful Buzz send suppresses automatic final-text publication. The model is explicitly told about fallback publication, and non-mention wakes may be silent. |
| 2. Lost failure details | Structured results preserve native exit status, safe error text, subtype, and permission denials. Credential-helper remediation is no longer flattened. |
| 3. Model/prompt changes discard sessions | Session identity excludes model and dynamic prompt text. Resumed Claude runs use system-prompt snapshot refresh; the enforced CLI minimum is 2.1.267. |
| 4. Deadlines reported as Stop | Deadline, owner Stop, lifetime cancellation, and Reset have distinct outcomes. Queued cancellations settle promptly. |
| 5. Save aborts active work | Saving only affects subsequent turns; explicit Reset retains confirmation and closes admission before retiring work. |
| 6. Stale/excessive setup probes | Passive probes are deduplicated, explicit checks invalidate caches, credential changes obtain fresh status, and custom executable probing happens on blur rather than every keystroke. |
| 7. Forced-stop temporary residue | Subsequent runs conservatively remove day-old owned, inactive temporary directories. Windows files are assigned to the actual account even in elevated processes; ownership probes handle UTF-8 paths without progress-stream interference. Fresh/live, linked, foreign-owned, or uncertain entries are retained. Windows/app-exit limitations are documented. |
| 8. Notes lost before Claude starts | The native bridge emits a spawn marker; consumed notes are restored when that marker never arrived. |
| 9. Unbounded session retention | Associations are capped at 200 per agent, and explicit deletion/retirement evidence clears them. Disconnected memberships are not mistaken for deleted ones. |
| 10. Unsupported CLI reports ready | Automatic discovery skips older candidates; an explicitly selected old executable reports the required version. |

Additional corrections cover early malformed output, consumer exception attribution, host-launch error details, bridge environment injection variables, absolute Windows system helpers, safe context-suffix model aliases, reset races, duplicate activity reporting, and scoped UI styles. UI, setup state, runtime orchestration, and stream/storage logic are now separate modules.

## Verification and deliberate limits

- Integrated Linux regression run: **65 passed, 1 skipped, 0 failed**. The skipped ownership test requires a POSIX root runner; no foreign-ownership execution is claimed.
- Linux and native Windows ARM64: compiled helper launched through the real node -e command-line/stdio boundary; valid status and malformed credential rejection passed. Windows Credential Manager save/read/replace/remove also passed after the helper-path changes.
- Native Windows ARM64 additionally passed private-file creation and stale cleanup with elevated-process ownership and a non-ASCII temporary path. macOS fixtures resolve their real temporary paths rather than assuming `/var` is not a symlink.
- Windows CI exposed an inherited PowerShell 7 module path that broke cmdlet discovery in system PowerShell. Native helpers now discard `PSModulePath`; the fix passed an isolated CI-host ownership probe and native Node 22 regressions with a deliberately incompatible module path.
- CI includes Linux Node 20/22 and Windows/macOS Node 22, native credential smoke checks, compiled-helper launch, and reproducible artifacts. See the repository's Actions results for the corresponding commit.
- The README distinguishes actual Linux Buzz UI/model verification from native adapter CI. Full Windows/macOS Buzz UI/model runs and WSL deployment are not claimed.
- Blind snapshot absence-pruning was rejected: Buzz excludes disconnected communities and other viewers from otherwise-ready snapshots (host service lines 1274–1283 and 7216–7219). Absence is not deletion evidence.
- Owner-only ACLs and validation at native boundaries were retained. No bypass-permissions mode, plaintext credential fallback, new OAuth refresh implementation, or compatibility re-export was introduced.
- A static review cannot prove credential precedence inside every managed/gateway Claude installation or contain prompt injection running with the user's approved tools. Those trust boundaries, local transcripts, file-upload access, proxy limitations, and managed-policy constraints are documented.

## Original Fable report

# Review: buzz-claude-subscription 1.0.0 against Buzz 1.0.2

Static review only: nothing was run, built or tested. Plugin paths are relative to the plugin root. `host:` means `Buzz-v1.0.2/`.

## Executive verdict

**Not ready for general consumers yet, but no security blocker.** I found no exploitable flaw that crosses the stated same-user trust boundary. I found no plugin-side path to API billing: Claude is never launched without the stored token (`src/bridge.mjs:343-344`), and competing credentials are stripped (`src/bridge.mjs:37`).

There are three Medium behaviour defects and a set of Low ones, listed below. Separately, the README's permission claims rest on Claude CLI flags that neither repository can confirm, and Windows/macOS end-to-end runs are still unexercised (README says so).

Fix findings 1–5 before wider distribution.

## Confirmed findings, ranked

### 1. Medium — Assistant text is posted although the host prompt tells the model it is private

- **Where:** `src/plugin.jsx:236-243`, `src/session.mjs:193-196`; the plugin requests the `tools: true` prompt at `src/plugin.jsx:195`.
- **Host contract:** `host:src/features/agent-harness/base_prompt.md:18` says "Your assistant text is not published to Buzz"; lines 51-53 make silence a valid outcome. Only the `tools: false` prompt promises posting (`host:src/features/agent-harness/kit.ts:183-185`).
- **Reproduction:**
  1. Owner mentions the agent. The model calls `send` with the answer but omits `final: true`, then ends with "I've replied in the thread."
  2. `finalPosted` is false and the text is not an exact match, so it is posted too. A reworded restatement posts the answer twice.
  3. On an Attention wake where the model correctly stays silent, its closing text is posted. If it ends with no text, line 242 throws and `run` posts an error tagging the owner.
- **Impact:** Duplicate and noise replies; text the model was told nobody sees is published to the whole channel.
- **Correction:** Return `undefined` from `finalReply` whenever any Buzz message was published this turn. Throw for a silent turn only when the trigger is a mention. Append one sentence to the `instructions` passed to `kit.systemPrompt` saying the last message is posted if no `send` happens.
- **Regression:** Fake kit: `send` without `final` succeeds, result text differs → exactly one publish. Attention wake with empty result → no publish, outcome ok.

### 2. Medium — The actionable failure cause is discarded

- **Where:**
  - `src/bridge.mjs:322` raises a generic `bridge_error` on any non-zero Claude exit.
  - `src/session.mjs:122,156` throws it before the exit code is returned, so `src/plugin.jsx:234` never reaches `TurnOutput.finish`. That function's `cancelled`, missing-result and `code !== 0` branches are effectively unreachable.
  - `src/session.mjs:87-90` drops the result's own text.
  - `src/bridge.mjs:15-17` flattens every plain `Error`, including the specific ones in `src/credentials.mjs:84-98`.
- **Reproduction:** Claude emits a terminal `result` with `is_error: true` and exits non-zero (usage limit, expired token, max turns). The user sees "Claude exited unsuccessfully. Check the result event, OAuth subscription, and CLI compatibility." The exit status for error results is CLI behaviour I could not verify; if it exits 0, the richer branch runs but still omits the CLI's text.
- **Impact:** Expired or revoked token, usage limit, bad model and incompatible CLI are indistinguishable.
- **Correction:** In `runClaude`, fail on non-zero exit only when no `result` was seen; otherwise pass the code through. Include `result.result` via `safeMessage`, truncated. Throw `BridgeError` from `credentials.mjs`.
- **Regression:** Fixture CLI prints an `error_max_turns` result with a `Bash` denial and exits 1 → the message contains the subtype, the text and "Bash".

### 3. Medium — A per-message model pick discards the conversation's Claude session

- **Where:** `src/plugin.jsx:197-200` puts `delivery.model || config.model` and the whole system prompt in the fingerprint; `src/session.mjs:174-177` deletes the record on mismatch; `src/plugin.jsx:290` offers the picks.
- **Reproduction:** A thread has a session on `sonnet`. The owner picks `opus` for one message → new session. The next unpicked message flips the fingerprint back → another new session. The same happens when core memory, team or agent name changes (`host:src/bundled/claude-code/prompt.ts:61-79`).
- **Impact:** Silent loss of continuity during a normal UI action. Only the latest 12 messages, 4,000 characters each, are re-shown (`host:src/bundled/claude-code/prompt.ts:32-34`). This contradicts README line 39.
- **Correction:** Drop the model from the fingerprint. For memory and team drift, consider `--system-prompt-snapshot off` as the bundled harness does (`host:src/bundled/claude-code/claude.ts:277-280`, needs CLI ≥ 2.1.267). Verify both against the CLI first.
- **Regression:** Second turn with `delivery.model` set → bridge request has `resume: true` and the same `sessionId`.

### 4. Low — The run deadline, including queue time, is reported as an owner Stop

- **Where:** `src/plugin.jsx:259-262,269`; lane wait at `src/session.mjs:102-107`.
- **Host contract:** The signal is the agent lifetime OR a timer started at dispatch (`host:src/features/agents/runner.ts:2706-2710`), documented as advisory (`host:src/features/agents/service.ts:785-787`). A `stopped` outcome renders "Stopped" (`host:src/features/agents/local-activity.ts:587,667`).
- **Reproduction:** Three mentions in one conversation, the first two taking about 15 minutes each. At 30 minutes the second is killed mid-turn and the third is rejected in the lane. Both show "Stopped" with no reply.
- **Impact:** Unanswered requests the owner never stopped, with no explanation.
- **Correction:** Record why the controller aborted. When the cause is the deadline (`delivery.signal.aborted && delivery.current()`), return `{ ok: false, error }` and post one reply. Better, start a per-turn timer when the lane grants the turn.
- **Regression:** Gated first turn plus a timed-out second → `{ok:false, error:/deadline/}`; explicit stop → `{ok:true, stopped:true}`.

### 5. Low — "Save settings" aborts the agent's running turns without warning

- **Where:** `src/plugin.jsx:161-169` calls `retire` (`149-154`). Reset confirms first (line 176); Save does not.
- **Reproduction:** The agent is mid-turn in thread A. The owner edits instructions and saves → the turn is killed and shows "Stopped".
- **Impact:** Lost work. The abort is also unnecessary, because the new config already changes the fingerprint.
- **Correction:** Remove `retire` from `commit`, or confirm when turns are active.
- **Regression:** Gated turn, call `commit` → controller not aborted.

### 6. Low — Setup UI: stale status after saving, and a probe per notification or keystroke

- **Where:** `src/plugin.jsx:50` returns the in-flight check; `:95` awaits it; `:139-144` keys an effect on the `connection` object and `binary`.
- **Reproduction A:** Open the card, then paste and save before the mount-time check finishes. The pre-save result is reused: "Token saved" appears beside "Not configured".
- **Reproduction B:** Opening the new-agent form starts four status processes, two of which are killed. A credential change adds four more. Each keystroke in "Claude executable" starts another, and any intermediate path that is an executable file is run with `--version`.
- **Impact:** Confusing readiness, repeated keyring prompts when locked, and execution of half-typed paths.
- **Correction:** After a credential change, wait out any in-flight check and start a fresh one. Key the effect on a counter bumped when a check completes. Debounce the path field or probe on blur.
- **Regression:** Fake `host.spawn` counter: mount → at most 2 spawns; ten keystrokes → 1 spawn; save during a check → `tokenStored: true`.

### 7. Low — Windows cancellation and any app quit leave the private temp directory behind

- **Where:** Cleanup needs the bridge to survive the stop (`src/bridge.mjs:324-327`, `src/bridge-cli.mjs:5-13`).
- **Host behaviour:** The Windows stop is `TerminateJobObject` with no signal (`host:src-tauri/src/host_process.rs:262-263`). App exit sends SIGKILL at once (`host:src-tauri/src/host_process.rs:369-380`).
- **Impact:** `system.txt` (instructions, team roster, core memory) and `mcp.json` (token for a closed server) accumulate in `%TEMP%`. The owner-only ACL holds, so this is residue rather than disclosure. README line 52 presents it as the exception and omits the prompt file.
- **Correction:** At the start of each `run`, delete `buzz-claude-subscription-*` directories older than the run limit plus a margin. Correct the README.
- **Regression:** A stale directory with an old mtime is removed by the next run; a fresh one is kept.

### 8. Low — Plugin notes are not restored when the bridge fails before Claude starts

- **Where:** `src/plugin.jsx:232,248`. `sent` is set once the request reaches the bridge's stdin (`src/session.mjs:151-152`), before token lookup, CLI discovery and spawn.
- **Host contract:** `restore()` is for "a turn that never started" (`host:src/features/agent-harness/kit.ts:63-64`); notes are not persisted (`host:src/features/agents/service.ts:1640-1646`).
- **Reproduction:** Another plugin leaves a note; the keyring is locked; the turn fails; the note is gone on retry.
- **Correction:** Set the flag on the first non-`bridge_*` event.
- **Regression:** Fake bridge emitting only `bridge_error` → `restore` called once.

### 9. Low — Saved session records are never expired, capped or cleaned up

- **Where:** `src/session.mjs:167-190`; `src/plugin.jsx:245` writes `at`, `channelId` and `root`, which nothing reads.
- **Host behaviour:** One file per key (`host:src-tauri/src/agent_state.rs:6-12`); `scan` loads the whole directory (`host:src/features/agents/state.ts:136-141`). The bundled harness caps at 200 per agent (`host:src/bundled/claude-code/sessions.ts:24-25`). `retire` is called only for protection and type changes (`host:src/features/agents/service.ts:2268,5129`).
- **Impact:** Unbounded growth of agent state, read in full at every start; records of deleted agents persist.
- **Correction:** Cap per agent by `at`; prune at startup against `ctx.agents.snapshot()`.
- **Regression:** 201 puts → the oldest is gone.

### 10. Low — The documented minimum Claude Code version is not enforced

- **Where:** README line 11 versus `src/bridge.mjs:229-231` and `src/plugin.jsx:59`. The bundled harness enforces its floor (`host:src/bundled/claude-code/setup.ts:38-40`).
- **Reproduction:** An older CLI is first on PATH → status "ready"; every turn fails with the generic message from finding 2.
- **Correction:** Compare against a constant; skip older auto-detected candidates; fail an explicit one by name.
- **Regression:** Fixture printing `2.1.100 (Claude Code)` → not ready, with a version message.

### Minor confirmed defects

| Where | Defect | Correction |
|---|---|---|
| `src/plugin.jsx:123,142,229`; `src/bridge.mjs:61` | A blank or space-padded model or folder passes the create form, then fails every turn. Bracketed aliases are rejected. | Trim; send no model when blank; include both in readiness. |
| `src/plugin.jsx:277`; `src/session.mjs:102-107` | Stop on a queued turn hangs until the turn ahead finishes (`host:src/features/agents/local-activity.ts:151-167`). | Race the lane wait against the abort. |
| `src/session.mjs:141-143` | Every `host.spawn` rejection reads "Install Node.js". | Keep the host's message. |
| `src/session.mjs:40-46` | An exception in the event consumer is reported as invalid JSON and kills the turn. | Parse inside the `try`, dispatch outside. |
| `src/session.mjs:125-128,144` | Non-JSON stdout before spawn resolves becomes a silent "stopped". | Throw the stored failure. |
| `src/bridge.mjs:338-341` | Status is all-or-nothing and reads the secret to return a boolean. | Report token and CLI separately. |
| `src/plugin.jsx:56` | Device readiness ignores a per-agent executable path. | Document it, or accept a path. |
| `src/plugin.jsx:170-174` | A mention arriving during Reset can re-save its old session after `clear`. | Block new turns for the key while retiring. |
| `src/plugin.jsx:215-222`; `src/session.mjs:64-75` | One tool call reports up to three steps under two names. | One source; strip the `mcp__buzz__` prefix. |

## Conditional risks and unverified assumptions

- **CLI flag surface.** `--permission-prompts none`, `--permission-mode manual`, `--append-system-prompt-file`, the `mcp__buzz__*` wildcard and stable session IDs across `--resume` cannot be checked here. The host's own harness uses `bypassPermissions` instead (`host:src/bundled/claude-code/claude.ts:305`). The README's "denied and reported instead of hanging" depends on them; tests assert only argv strings.
- **Fallback to the saved login.** The plugin shares the real `~/.claude` (it removes `CLAUDE_CONFIG_DIR` rather than redirecting it), and managed settings still load (`host:src/bundled/claude-code/claude.ts:284-287`). If the CLI falls back when the token is rejected, and that login is API-billed, it would bill. Test with a deliberately invalid token. A plugin-owned config directory removes the possibility.
- **Token reachable by the model.** The token is in Claude's environment, `mcp__buzz__*` is pre-approved, and thread context from other members reaches the prompt as data (`host:src/features/agent-harness/kit.ts:331-366`). A successful injection could post it. README line 54 discloses the general point.
- **Buzz file tools.** `read` accepts absolute and `~/` paths with no containment (`src/plugin.jsx:214`, `host:src-tauri/src/host_files.rs:64-76`). `send` can therefore upload any readable file up to 50 MB in either permission mode. This matches bundled harnesses, but the UI wording does not convey it.
- **Resume after transcript cleanup.** If the CLI prunes old transcripts (I believe 30 days by default), the first turn in an old thread fails once, then recovers.
- **Windows launch.** `node -e` with about 24,000 characters is untested inside Buzz. The build guard (`scripts/build.mjs:21-23`) counts unescaped characters. `Add-Type` is blocked under Constrained Language Mode. npm `.cmd` installs are not found (`src/bridge.mjs:193`).
- **Windows helper lookup.** `powershell.exe` and `icacls.exe` are spawned by bare name (`src/credentials.mjs:92`, `src/bridge.mjs:244,247`). Node on Windows checks the current directory first, and the bridge inherits Buzz's. Use `%SystemRoot%\System32` paths.
- **Bridge environment.** The bridge runs with the app's unfiltered environment (`src/session.mjs:132-140`). An inherited `NODE_OPTIONS` applies to the process holding the token. Pass `env: { NODE_OPTIONS: null, NODE_PATH: null }`.
- **Proxies.** Proxy and CA variables are stripped (`src/bridge.mjs:38`), so users behind a mandatory proxy fail with the generic error.
- **Descendants.** The host kills the bridge's process group or job (`host:src-tauri/src/host_process.rs:258-288`), which matches `src/bridge.mjs:101`. A descendant that leaves the group, or holds Claude's stdout open, is outside that guarantee.
- **Event size.** A stream event over 4 MiB, such as a large image result, aborts the turn (`src/bridge.mjs:296,314`).
- **MCP reconnect.** A second `initialize` stops the server (`host:src-tauri/src/host_mcp.rs:388-402`), so a mid-turn reconnect loses the Buzz tools.

## Cleanup opportunities

- **Duplicate validation.** Bridge and plugin both validate the stream, which is how finding 2 arose. `validateRequest` runs three times per run (`src/bridge.mjs:94,272,331`). Token and UUID patterns are repeated across three files.
- **Redundant chunking.** `jsonChunks` (`src/session.mjs:199-207`) repeats the host's own write splitting (`host:src/features/host/service.ts:428-442`).
- **Redundant save branch.** The `pendingSave` branch (`src/plugin.jsx:164-165`) repeats the host's wrapper (`host:src/features/agents/tabs.tsx:125-129`).
- **Partial messages.** `--include-partial-messages` relays every token delta only to label tool steps slightly earlier.
- **Windows per-turn overhead.** Each turn runs two PowerShell launches and `icacls` before Claude starts. `%TEMP%` is already per-user. `chmod` after `mkdtemp` is redundant (`src/bridge.mjs:249`).
- **Speculative paths.** The Windows managed-install roots (`src/bridge.mjs:199-200`) have no counterpart in Buzz 1.0.2 (`host:src/bundled/claude-code/setup.ts:42-47`).
- **Structure.** `src/plugin.jsx` is one closure with lines over 1,000 characters (107-116, 176). Split UI from turn logic and add a formatter.
- **Styling.** The inline `<style>` block restyles host controls, against `host:docs/plugin-authoring-guide.md:151,154`.
- **Tests.** Nothing covers `src/plugin.jsx` or `bridgeRequest`.
- **CI.** There is no Node 20 job despite `engines >=20`, and no step launching the built bridge with `node -e` on each OS. Actions are pinned by tag.

## Missing user instructions

- **Data handling.** Buzz tools are pre-approved and can read and upload any local file. Conversation content, the system prompt and core memory are stored as plaintext transcripts in `~/.claude/projects`.
- **Session behaviour.** Sessions restart after a stop, any failure, a model pick, a memory or team change, or a settings save. "History" means the latest 12 messages.
- **Unsupported triggers.** Standalone watch and timer turns are ignored (no `runOnce`). Turns running when Buzz closes are not resumed.
- **Environment.** Proxy and custom-CA setups are unsupported. `AWS_*`, `GOOGLE_*`, `AZURE_*` and similar variables are removed. Managed Claude settings still apply.
- **Platform setup.** Linux GUI launches may not see nvm/fnm/volta `node`. Windows needs the native `claude.exe`.
- **Token removal.** Remove the token before uninstalling; give the manual command per OS and how to revoke at Anthropic. One token serves every agent and community on the OS account.
- **Install source.** Install from a tag or commit, not mutable `main`. `SHA256SUMS` is not a signature.
- **Wording.** The custom executable is a per-agent field, not a plugin setting (README line 11).

## Conclusions by category

| Category | Result |
|---|---|
| Correctness | Findings 1–5, 8, 10. |
| Maintainability, complexity | See Cleanup. |
| OS assumptions | Finding 7; Windows items under Conditional. macOS and Linux paths match the host (`host:src/bundled/claude-code/claude.sh:19-22`). |
| Credential storage, token lifecycle | No confirmed defect. Stdin-only transport, no plaintext fallback and macOS save verification are sound. Expiry and revocation are poorly reported (finding 2). |
| Auth isolation, billing fallback | No confirmed finding; one unverified assumption. |
| Subprocess start, cancel, descendants | No confirmed defect on Unix. The 1.5 s kill escalation fits the host's 3 s grace. Windows is finding 7. |
| Temp data and ACLs | Permissions correct (0700/0600, `wx`, owner-only ACL). Residue is finding 7. |
| MCP header and tool scope | No confirmed finding. Loopback-only, 256-bit token, single session, per-turn server closed in `finally`. |
| Stream framing, failure ordering | Framing is correct, and the host preserves split UTF-8 (`host:src-tauri/src/host_process.rs:855-866`). Ordering is finding 2. |
| Session and cursor persistence, races | Findings 3, 9; the Reset race is minor. Keying, the in-flight marker and the session-ID check are sound. |
| Membership retirement | No confirmed finding. The host retires only while idle and blocks new turns (`host:src/features/agents/runner.ts:961-1001`). Publishing is lifetime-guarded. |
| Duplicate replies | Finding 1. |
| UI lifecycle, readiness | Finding 6. |
| Executable resolution | Finding 10 and the keystroke probing in finding 6. Traversal through the `current` pointer is blocked. |
| Dependency and build integrity | No confirmed finding. One exact-pinned dev dependency, lockfile hashes, `--ignore-scripts`, CI reproducibility check. |
| Permission claims | The manifest matches use (`files`, `mcp`, one `node` process). Behavioural claims depend on unverified CLI flags. |
| Documentation accuracy | Inaccuracies at README lines 11, 39 and 52, plus the omissions above. |

**General code review:** The design is disciplined, with good low-level tests. Its weak spots are the untested orchestration layer and the duplicated error handling between bridge and plugin.

**Adversarial review:** Untrusted input reaches only the prompt. Argument, path, header and environment construction resist injection. Malformed events fail closed. The residual exposure is prompt injection acting through pre-approved Buzz tools and the token in Claude's environment, which is inside the declared trust boundary but under-documented.

## Coverage and limitations

- **Read in full:** all five source modules, both scripts, all three test files, manifest, package files, CI workflow, README, LICENSE, `.gitignore`, `.gitattributes`, `dist/manifest.json`, `dist/SHA256SUMS`.
- **Not reviewed:** `dist/plugin.js`, apart from one count search for event names. `node_modules` and `.git` were not opened.
- **Host contracts verified in source:** process spawn/kill/environment, program resolution, MCP server, file access, agent storage, harness kit, runner lifecycle, local activity, prompts, the bundled Claude harness, and the authoring guide.
- **Not verifiable here:** all Claude Code CLI behaviour (flags, exit codes, session IDs, transcript retention, credential precedence) and the behaviour of `secret-tool`, `security` and PowerShell. These are stated from general knowledge and marked as such.