import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdtemp, open, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, normalize } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { credentialCommand, powershellArguments } from './credentials.mjs';
import { BridgeError, windowsHelper } from './native-platform.mjs';

export const LIMITS = Object.freeze({ request: 4 * 1024 * 1024, token: 8192, line: 4 * 1024 * 1024, output: 128 * 1024 * 1024, secretTimeout: 12000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/;
export const MIN_CLAUDE_VERSION = '2.1.267';
// The host caps turns at 30 minutes. A day also covers termination/clock margins.
export const STALE_RUN_AGE = 24 * 60 * 60 * 1000;

const fail = (message) => { throw new BridgeError(message); };
export function publicError(error) {
  return error instanceof BridgeError ? error.message : 'The bridge operation failed. Check Claude Code and your operating system credential store availability.';
}

export function validateToken(token) {
  if (typeof token !== 'string' || token.length > LIMITS.token || !/^sk-ant-oat\d{2}-[A-Za-z0-9_-]{16,}$/.test(token)) {
    fail('Enter a valid long-lived Claude OAuth token beginning sk-ant-oat, without whitespace.');
  }
  return token;
}

export function expandPath(value, home = homedir()) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) fail('Paths must be absolute paths or start with ~/.');
  if (value === '~') return home;
  if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) return normalize(join(home, value.slice(2)));
  if (!isAbsolute(value)) fail('Paths must be absolute paths or start with ~/.');
  return normalize(value);
}

export function isolatedEnv(source = process.env, token) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(?:ANTHROPIC|CLAUDE|AWS|AMAZON|BEDROCK|GOOGLE|GCLOUD|GCP|VERTEX|AZURE|FOUNDRY|OPENAI|LITELLM|OTEL)(?:_|$)/i.test(key) || /^CLAUDECODE$/i.test(key)) continue;
    // System PowerShell must resolve its own modules, not inherited PowerShell 7/custom modules.
    if (/^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|PSMODULEPATH|BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*)$/i.test(key)) continue;
    if (value !== undefined) env[key] = value;
  }
  if (token !== undefined) env.CLAUDE_CODE_OAUTH_TOKEN = validateToken(token);
  return env;
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, max, nonempty = false) { return typeof value === 'string' && Buffer.byteLength(value) <= max && (!nonempty || value.length > 0) && !value.includes('\0'); }

export function validateRequest(request) {
  if (!object(request) || !['status', 'save', 'remove', 'run'].includes(request.action)) fail('Invalid bridge request.');
  const fields = request.action === 'run'
    ? ['action', 'binary', 'model', 'prompt', 'systemPrompt', 'sessionId', 'resume', 'mcp', 'permissionMode', 'cwd', 'allowedTools']
    : request.action === 'save' ? ['action', 'token', 'binary'] : ['action', 'binary'];
  if (Object.keys(request).some((key) => !fields.includes(key))) fail('Unexpected bridge request field.');
  if (request.binary !== undefined && request.binary !== '' && request.binary !== 'claude') expandPath(request.binary);
  if (request.binary !== undefined && typeof request.binary !== 'string') fail('Invalid Claude executable path.');
  if (request.action === 'save') validateToken(request.token);
  if (request.action !== 'run') return request;
  if (!text(request.prompt, 2 * 1024 * 1024, true) || !text(request.systemPrompt, 1024 * 1024)) fail('Invalid or oversized prompt.');
  if (!UUID.test(request.sessionId ?? '') || typeof request.sessionId !== 'string' || typeof request.resume !== 'boolean') fail('A valid session UUID and explicit resume flag are required.');
  if (!['default', 'acceptEdits'].includes(request.permissionMode)) fail('Only default and acceptEdits permission modes are supported.');
  if (request.allowedTools !== undefined) validateAllowedTools(request.allowedTools);
  if (request.model !== undefined && (typeof request.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}(?:\[1m\])?$/.test(request.model))) fail('Invalid Claude model.');
  expandPath(request.cwd);
  if (!object(request.mcp) || Object.keys(request.mcp).some((key) => !['url', 'headers'].includes(key))) fail('Invalid Buzz MCP configuration.');
  let url;
  try { url = new URL(request.mcp.url); } catch { fail('Invalid Buzz MCP URL.'); }
  if (!text(request.mcp.url, 8192, true) || !['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash) fail('Buzz MCP must use a loopback HTTP endpoint without URL credentials.');
  if (!Array.isArray(request.mcp.headers) || request.mcp.headers.length > 32) fail('Invalid Buzz MCP headers.');
  const names = new Set();
  for (const header of request.mcp.headers) {
    if (!object(header) || Object.keys(header).some((key) => !['name', 'value'].includes(key)) || !text(header.name, 128, true) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name) || !text(header.value, 16384) || /[\x00-\x1f\x7f]/.test(header.value)) fail('Invalid Buzz MCP header.');
    const name = header.name.toLowerCase();
    if (names.has(name) || ['host', 'content-length', 'transfer-encoding', 'connection'].includes(name)) fail('Invalid or duplicate Buzz MCP header.');
    names.add(name);
  }
  return request;
}

export async function readRequest(input, { signal, timeout = 15000 } = {}) {
  let size = 0;
  const chunks = [];
  const abort = () => input.destroy(new BridgeError('Bridge request cancelled.'));
  const timer = setTimeout(() => input.destroy(new BridgeError('Timed out waiting for a complete bridge request.')), timeout);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) fail('Bridge request cancelled.');
    for await (const chunk of input) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > LIMITS.request) fail('Bridge request exceeds the size limit.');
      chunks.push(buffer);
    }
    let request;
    try { request = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { fail('Bridge input must contain exactly one JSON request.'); }
    return request;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

// Child processes deliberately remain in the host-owned process group.
function trackChild(child, signal) {
  let killTimer;
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1500);
  };
  const closed = new Promise((resolve) => {
    child.once('error', () => resolve({ code: null, failed: true }));
    child.once('close', (code) => resolve({ code, failed: false }));
  });
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  return {
    stop, closed,
    dispose() { clearTimeout(killTimer); signal?.removeEventListener('abort', stop); },
  };
}

async function capture(binary, args, { input = '', env = isolatedEnv(), timeout = LIMITS.secretTimeout, limit = 16384, signal } = {}) {
  if (signal?.aborted) fail('Bridge operation cancelled.');
  const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const tracked = trackChild(child, signal);
  const chunks = [];
  let size = 0, stderrSize = 0, exceeded = false, timedOut = false;
  child.stdout.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) { exceeded = true; tracked.stop(); } else chunks.push(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrSize += chunk.length;
    if (stderrSize > limit) { exceeded = true; tracked.stop(); }
  });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const timer = setTimeout(() => { timedOut = true; tracked.stop(); }, timeout);
  try {
    const result = await tracked.closed;
    if (signal?.aborted) fail('Bridge operation cancelled.');
    if (timedOut) fail('Credential or CLI operation timed out. Unlock your desktop keyring and confirm Claude Code is installed, then retry.');
    if (exceeded) fail('Credential or CLI response exceeded the size limit.');
    if (result.failed) fail('Unable to launch a required executable. Check Claude Code and your OS credential helper (secret-tool on Linux, security on macOS, PowerShell on Windows).');
    return { code: result.code, output: Buffer.concat(chunks).toString('utf8'), hasStderr: stderrSize > 0 };
  } finally { clearTimeout(timer); tracked.dispose(); }
}

export async function credentialOperation(action, { token, signal, platform = process.platform, service, account } = {}) {
  if (action === 'save') validateToken(token);
  const command = credentialCommand(platform, action, token, { service, account });
  const result = await capture(command.binary, command.args, { input: command.input, signal, limit: LIMITS.token + 1024, timeout: platform === 'win32' ? 20000 : LIMITS.secretTimeout });
  const missing = result.code === command.missing && (platform === 'darwin' || platform === 'win32' || (!result.hasStderr && result.output === ''));
  if (missing && action !== 'save') return null;
  if (result.code !== 0) fail('Cannot access the OS credential store. Unlock your keyring or Keychain, or check Windows Credential Manager. Linux and WSL require a desktop Secret Service and secret-tool.');
  if (action === 'lookup') return result.output.replace(/\r?\n$/, '') || null;
  // security -i may report an individual command failure without a failing exit code.
  if (action === 'save' && platform === 'darwin') {
    const stored = await credentialOperation('lookup', { signal, platform, service, account });
    if (stored !== token) fail('Keychain did not save the token. Unlock your login Keychain and approve credential access, then retry.');
  }
  return null;
}

export async function lookupToken(options = {}) {
  const token = await credentialOperation('lookup', options);
  if (token === null) return null;
  try { return validateToken(token); } catch { fail('The stored OAuth token is invalid. Replace it in the harness settings.'); }
}

export async function saveToken(token, options = {}) {
  await credentialOperation('save', { ...options, token });
}

export async function removeToken(options = {}) {
  await credentialOperation('remove', options);
}

async function readSmallFile(path, limit) {
  const file = await open(path, 'r');
  try {
    if (!(await file.stat()).isFile()) return null;
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytesRead <= limit ? bytes.subarray(0, bytesRead).toString('utf8') : null;
  } finally { await file.close(); }
}

export function supportedClaudeVersion(version) {
  if (!VERSION.test(version)) return false;
  const actual = version.split('-')[0].split('.').map(Number);
  const minimum = MIN_CLAUDE_VERSION.split('.').map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  }
  return !version.includes('-');
}

export async function resolveClaude(binary, { env = process.env, home = homedir(), signal } = {}) {
  const explicit = binary !== undefined && binary !== '' && binary !== 'claude';
  const candidates = [];
  if (explicit) candidates.push(expandPath(binary, home));
  else {
    const executable = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
    for (const directory of path.split(delimiter)) if (isAbsolute(directory)) candidates.push(join(directory, executable));
    candidates.push(join(home, '.local', 'bin', executable), join(home, '.claude', 'local', executable));
    const roots = process.platform === 'darwin'
      ? [join(home, 'Library', 'Application Support', 'Buzz', 'claude-code'), join(home, 'Library', 'Application Support', 'buzz', 'claude-code')]
      : process.platform === 'win32'
        ? [join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Buzz', 'claude-code'), join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Buzz', 'claude-code')]
        : [join(env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share'), 'buzz', 'claude-code')];
    if (process.platform === 'win32') {
      const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
      candidates.push(join(local, 'Microsoft', 'WinGet', 'Links', executable));
      try {
        const packages = join(local, 'Microsoft', 'WinGet', 'Packages');
        const entries = (await readdir(packages, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^Anthropic\.ClaudeCode_/.test(entry.name)).slice(0, 16);
        for (const entry of entries) candidates.push(join(packages, entry.name, executable));
      } catch { /* WinGet is optional. */ }
    }
    for (const root of roots) {
      try {
        const current = (await readSmallFile(join(root, 'current'), 128))?.trim();
        if (current && VERSION.test(current)) candidates.push(join(root, current, executable));
      } catch { /* A missing or invalid managed pointer is not executable. */ }
      try {
        const versions = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && VERSION.test(entry.name)).map((entry) => entry.name);
        versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
        for (const version of versions.slice(0, 32)) candidates.push(join(root, version, executable));
      } catch { /* Managed Claude is optional when PATH provides it. */ }
    }
  }
  let oldVersion;
  for (const candidate of new Set(candidates)) {
    if (signal?.aborted) fail('Bridge operation cancelled.');
    try {
      await access(candidate, constants.X_OK);
      if (!(await stat(candidate)).isFile()) continue;
      const resolved = await realpath(candidate);
      const result = await capture(resolved, ['--version'], { env: isolatedEnv(env), signal, timeout: 8000, limit: 4096 });
      const match = result.output.trim().match(/^(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)(?:\s+\(Claude Code\))?$/);
      if (result.code === 0 && match && VERSION.test(match[1])) {
        if (supportedClaudeVersion(match[1])) return { binary: resolved, version: match[1] };
        oldVersion ??= match[1];
      }
    } catch {
      if (signal?.aborted) fail('Bridge operation cancelled.');
    }
  }
  if (oldVersion) fail(`${explicit ? 'The configured Claude executable reports' : 'Only outdated Claude Code executables were found; detected'} ${oldVersion}. Install Claude Code ${MIN_CLAUDE_VERSION} or newer for dynamic system-prompt support.`);
  if (explicit) fail('The configured Claude executable is unavailable or did not report a valid version.');
  return null;
}

export async function cleanupStaleRunFiles({ root = tmpdir(), now = Date.now(), signal } = {}) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  const cutoff = now - STALE_RUN_AGE;
  const uid = process.getuid?.();
  for (const entry of entries) {
    if (signal?.aborted) return;
    if (!/^buzz-claude-subscription-[A-Za-z0-9]{6}$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(root, entry.name);
    try {
      const before = await lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink() || before.mtimeMs >= cutoff || (uid !== undefined && before.uid !== uid)) continue;
      const children = await readdir(directory);
      if (children.some((name) => !['system.txt', 'mcp.json', 'run-owner.json'].includes(name))) continue;
      let safe = true;
      for (const name of children) {
        const info = await lstat(join(directory, name));
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mtimeMs >= cutoff || (uid !== undefined && info.uid !== uid)) { safe = false; break; }
      }
      if (!safe) continue;
      if (children.includes('run-owner.json')) {
        const owner = JSON.parse(await readSmallFile(join(directory, 'run-owner.json'), 256));
        if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) continue;
        try { process.kill(owner.pid, 0); continue; } catch (error) { if (error.code !== 'ESRCH') continue; }
      }
      if (process.platform === 'win32') {
        // Node's Windows uid is not an ownership check. Compare the account SID
        // for every candidate, and fail closed on ACL/reparse/access failures.
        const ownership = await capture(windowsHelper('powershell'), powershellArguments(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach ($path in $paths) {
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }
    $owner = (Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $sid) { exit 1 }
  }
  [Console]::Out.Write('owned')
} catch { exit 1 }
`), { input: JSON.stringify([directory, ...children.map((name) => join(directory, name))]), signal, limit: 256 });
        if (ownership.code !== 0 || ownership.output !== 'owned') continue;
      } else if (uid === undefined) continue;
      const current = await lstat(directory);
      if (current.dev !== before.dev || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.isSymbolicLink()) continue;
      await rm(directory, { recursive: true, force: true });
    } catch { /* Residue is preferable to deleting anything uncertain or inaccessible. */ }
  }
}

export async function createRunFiles(request, { root = tmpdir(), signal } = {}) {
  const directory = await mkdtemp(join(root, 'buzz-claude-subscription-'));
  let sid;
  try {
    if (process.platform === 'win32') {
      const identity = await capture(windowsHelper('powershell'), powershellArguments('[Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)'), { limit: 4096, signal });
      sid = identity.output.trim();
      if (identity.code !== 0 || !/^S-1-\d+(?:-\d+)+$/.test(sid)) fail('Cannot determine the Windows account for private temporary files.');
      const acl = await capture(windowsHelper('icacls'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '/q'], { limit: 4096, signal });
      if (acl.code !== 0) fail('Cannot secure private temporary files with Windows ACLs.');
    } else await chmod(directory, 0o700);
    if (signal?.aborted) fail('Claude run cancelled.');
    await writeFile(join(directory, 'run-owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' });
    const system = join(directory, 'system.txt');
    const mcp = join(directory, 'mcp.json');
    const headers = Object.fromEntries(request.mcp.headers.map(({ name, value }) => [name, value]));
    await writeFile(system, request.systemPrompt, { mode: 0o600, flag: 'wx' });
    await writeFile(mcp, JSON.stringify({ mcpServers: { buzz: { type: 'http', url: request.mcp.url, headers } } }), { mode: 0o600, flag: 'wx' });
    if (sid) {
      // Elevated processes otherwise assign Administrators ownership, preventing
      // later account-specific cleanup even though the private DACL is correct.
      const owner = await capture(windowsHelper('icacls'), [directory, '/setowner', `*${sid}`, '/T', '/q'], { limit: 4096, signal });
      if (owner.code !== 0) fail('Cannot set private temporary-file ownership.');
    }
    return { directory, system, mcp, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

// Tool names Claude accepts in --allowedTools: a tool, optionally with a
// specifier such as Bash(git:*). The owner lists them per agent; nothing here
// bypasses permissions, unlisted tools still deny with prompts off.
const ALLOWED_TOOL = /^[A-Za-z0-9][A-Za-z0-9_*:.\-]{0,63}(?:\([^\n\0(),]{0,200}\))?$/;
export function validateAllowedTools(value) {
  if (!Array.isArray(value) || value.length > 64 || value.some((tool) => typeof tool !== 'string' || !ALLOWED_TOOL.test(tool))) fail('Invalid allowed tools list.');
  return value;
}

export function claudeArguments(request, files) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--system-prompt-snapshot', 'off', '--strict-mcp-config', '--mcp-config', files.mcp, '--append-system-prompt-file', files.system, '--permission-prompts', 'none', '--allowedTools', ['mcp__buzz__*', ...(request.allowedTools ?? [])].join(',')];
  args.push('--permission-mode', request.permissionMode === 'acceptEdits' ? 'acceptEdits' : 'manual');
  if (request.model) args.push('--model', request.model);
  args.push(request.resume ? '--resume' : '--session-id', request.sessionId);
  return args;
}

export async function runClaude(request, { binary, token, emit, signal, tempRoot } = {}) {
  validateRequest(request);
  validateToken(token);
  const cwd = expandPath(request.cwd);
  try { if (!(await stat(cwd)).isDirectory()) fail('The requested working directory does not exist.'); }
  catch { fail('The requested working directory does not exist or is inaccessible.'); }
  if (signal?.aborted) fail('Claude run cancelled.');
  await cleanupStaleRunFiles({ root: tempRoot, signal });
  const files = await createRunFiles(request, { root: tempRoot, signal });
  let tracked;
  try {
    if (signal?.aborted) fail('Claude run cancelled.');
    const child = spawn(binary, claudeArguments(request, files), { cwd, env: isolatedEnv(process.env, token), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    tracked = trackChild(child, signal);
    let stderrSize = 0, stderrExceeded = false;
    child.stderr.on('data', (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize > 1024 * 1024) { stderrExceeded = true; tracked.stop(); }
    });
    child.stdin.on('error', () => {});
    const spawned = await new Promise((resolve) => {
      child.once('spawn', () => resolve(true));
      child.once('error', () => resolve(false));
    });
    if (!spawned) fail('Unable to start the Claude executable.');
    await emit({ type: 'bridge_started' });
    child.stdin.end(request.prompt);
    const decoder = new StringDecoder('utf8');
    let pending = '', bytes = 0, sawResult = false;
    const secrets = [token, ...request.mcp.headers.map(({ value }) => value).filter((value) => value.length >= 8)];
    const event = async (line) => {
      if (line.trim() === '') return;
      if (Buffer.byteLength(line) > LIMITS.line) fail('Claude output exceeded the event size limit.');
      if (secrets.some((secret) => line.includes(secret) || line.includes(JSON.stringify(secret).slice(1, -1)))) fail('Sensitive credential material in Claude output was withheld.');
      let parsed;
      try { parsed = JSON.parse(line); } catch { fail('Claude returned invalid stream output. Confirm the installed CLI supports stream-json.'); }
      if (!object(parsed) || typeof parsed.type !== 'string') fail('Claude returned an invalid stream event.');
      if (parsed.type === 'result') sawResult = true;
      await emit(parsed);
    };
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (bytes > LIMITS.output) fail('Claude output exceeded the run size limit.');
      pending += decoder.write(chunk);
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        await event(line);
      }
      if (Buffer.byteLength(pending) > LIMITS.line) fail('Claude output exceeded the event size limit.');
    }
    pending += decoder.end();
    if (pending) await event(pending);
    const result = await tracked.closed;
    if (signal?.aborted) fail('Claude run cancelled.');
    if (stderrExceeded) fail('Claude diagnostic output exceeded the size limit.');
    if (result.failed) fail('Unable to start the Claude executable.');
    if (!sawResult) fail(result.code === 0 ? 'Claude exited without a final result event.' : 'Claude exited unsuccessfully without a final result. Check your OAuth subscription and CLI compatibility.');
    if (!Number.isInteger(result.code)) fail('Claude was terminated before it could exit normally.');
    return result.code;
  } finally {
    if (tracked) { tracked.stop(); await tracked.closed; tracked.dispose(); }
    await files.cleanup();
  }
}

export async function connectionStatus(binary, { signal, tokenLookup = lookupToken, cliLookup = resolveClaude } = {}) {
  const status = { tokenStored: false, binary: null, version: null };
  await Promise.all([
    (async () => {
      try { status.tokenStored = await tokenLookup({ signal }) !== null; }
      catch (error) { status.credentialError = publicError(error); }
    })(),
    (async () => {
      try {
        const cli = await cliLookup(binary, { signal });
        status.binary = cli?.binary ?? null;
        status.version = cli?.version ?? null;
        if (!cli) status.cliError = 'Claude Code was not found. Install Claude Code or configure its absolute executable path.';
      } catch (error) { status.cliError = publicError(error); }
    })(),
  ]);
  if (signal?.aborted) fail('Bridge operation cancelled.');
  return status;
}

export async function handleRequest(request, { emit, signal } = {}) {
  validateRequest(request);
  if (request.action === 'save') {
    await saveToken(request.token, { signal });
    await emit({ type: 'bridge_saved', tokenStored: true });
  } else if (request.action === 'remove') {
    await removeToken({ signal });
    await emit({ type: 'bridge_saved', tokenStored: false });
  } else if (request.action === 'status') {
    await emit({ type: 'bridge_status', ...await connectionStatus(request.binary, { signal }) });
  } else {
    const token = await lookupToken({ signal });
    if (!token) fail('No OAuth token is stored. Save a Claude subscription token in the harness settings first.');
    const cli = await resolveClaude(request.binary, { signal });
    if (!cli) fail('Claude Code was not found. Install Claude Code or configure its absolute executable path.');
    return await runClaude(request, { binary: cli.binary, token, emit, signal });
  }
  return 0;
}