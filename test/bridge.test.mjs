import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, chown, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { LIMITS, MIN_CLAUDE_VERSION, STALE_RUN_AGE, claudeArguments, cleanupStaleRunFiles, connectionStatus, createRunFiles, expandPath, isolatedEnv, publicError, readRequest, resolveClaude, runClaude, supportedClaudeVersion, validateRequest, validateToken } from '../src/bridge.mjs';
import { BridgeError } from '../src/native-platform.mjs';

const TOKEN = 'sk-ant-oat01-synthetic_non_authentication_token_123456789';
const request = (changes = {}) => ({ action: 'run', prompt: 'Test prompt', systemPrompt: 'Test instructions', sessionId: randomUUID(), resume: false, mcp: { url: 'http://127.0.0.1:1234/mcp', headers: [{ name: 'Authorization', value: 'Bearer synthetic_buzz_header' }] }, permissionMode: 'default', cwd: tmpdir(), ...changes });

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'buzz-bridge-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// An executable adversarial fixture exercises real OS pipes, signals and files, not a
// credential adapter substitute. Production always resolves the installed Claude CLI.
async function executable(root, source, name = 'claude-fixture') {
  const file = join(root, name);
  await writeFile(file, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return file;
}

const posix = { skip: process.platform === 'win32' ? 'POSIX executable/signal fixture; Windows ACL and credential tests run separately.' : false };

test('OAuth validation rejects API keys, whitespace, command injection, and oversized values', () => {
  assert.equal(validateToken(TOKEN), TOKEN);
  for (const value of [undefined, null, '', 'sk-ant-api03-not-a-subscription-token', `${TOKEN}\n`, ` ${TOKEN}`, `${TOKEN};quit`, `${TOKEN}"`, 'sk-ant-oat01-short', `sk-ant-oat01-${'a'.repeat(LIMITS.token)}`]) assert.throws(() => validateToken(value), BridgeError);
  assert.ok(!publicError(new Error(TOKEN)).includes(TOKEN));
});

test('isolated environment forbids API fallback, gateway/cloud credentials, nested sessions, and code injection', () => {
  const source = { PATH: '/usr/bin', HOME: '/home/test', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', ANTHROPIC_API_KEY: 'api', ANTHROPIC_AUTH_TOKEN: 'auth', ANTHROPIC_BASE_URL: 'https://gateway.invalid', ANTHROPIC_CUSTOM_HEADERS: 'Authorization: secret', CLAUDE_CODE_OAUTH_TOKEN: 'old', CLAUDE_CODE_API_KEY_HELPER: 'helper', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CONFIG_DIR: '/other', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'nested', AWS_SESSION_TOKEN: 'cloud', GOOGLE_APPLICATION_CREDENTIALS: '/credential.json', AZURE_API_KEY: 'cloud', OPENAI_API_KEY: 'api', HTTPS_PROXY: 'http://gateway.invalid', NODE_OPTIONS: '--require evil.js', LD_PRELOAD: '/evil.so' };
  assert.deepEqual(isolatedEnv(source, TOKEN), { PATH: source.PATH, HOME: source.HOME, DBUS_SESSION_BUS_ADDRESS: source.DBUS_SESSION_BUS_ADDRESS, CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
  assert.equal(isolatedEnv(source).CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(source.ANTHROPIC_API_KEY, 'api');
});

test('request validation rejects unsafe paths, session IDs, permission escalation and MCP endpoints', () => {
  assert.equal(validateRequest(request()).action, 'run');
  assert.equal(expandPath('~/work', tmpdir()), join(tmpdir(), 'work'));
  for (const value of ['relative/path', '~other/path', '--help', '/tmp/\0evil', '/tmp/\nevil']) assert.throws(() => expandPath(value));
  for (const changes of [{ sessionId: '../../sessions' }, { resume: 'yes' }, { permissionMode: 'bypassPermissions' }, { permissionMode: 'auto' }, { binary: '--help' }, { model: '--dangerously-skip-permissions' }, { extra: 'argument' }, { mcp: { url: 'https://example.com/mcp', headers: [] } }, { mcp: { url: 'http://user:password@localhost/mcp', headers: [] } }, { mcp: { url: 'http://localhost/mcp', headers: [{ name: 'Authorization', value: 'token\r\nHost: evil' }] } }, { mcp: { url: 'http://localhost/mcp', headers: [{ name: 'Host', value: 'evil' }] } }, { mcp: { url: 'http://localhost/mcp', headers: [{ name: 'X-Token', value: 'a' }, { name: 'x-token', value: 'b' }] } }]) assert.throws(() => validateRequest(request(changes)), BridgeError);
  assert.throws(() => validateRequest({ action: 'save', token: TOKEN, service: 'other' }), BridgeError);
});

test('stdin framing is one bounded JSON request, including timeout and abort', async () => {
  assert.deepEqual(await readRequest(Readable.from(['{"action":', '"status"}'])), { action: 'status' });
  await assert.rejects(readRequest(Readable.from(['{"action":"status"}\n{"action":"remove"}'])), BridgeError);
  await assert.rejects(readRequest(Readable.from([Buffer.alloc(LIMITS.request + 1)])), /size limit/);
  await assert.rejects(readRequest(new Readable({ read() {} }), { timeout: 10 }), /Timed out/);
  const controller = new AbortController();
  const pending = readRequest(new Readable({ read() {} }), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});

test('CLI args fix permission/settings isolation and never carry prompts or credentials', () => {
  const input = request();
  const args = claudeArguments(input, { mcp: '/private/mcp.json', system: '/private/system.txt' });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value('--permission-mode'), 'manual');
  assert.equal(value('--permission-prompts'), 'none');
  assert.equal(value('--setting-sources'), '');
  assert.equal(value('--system-prompt-snapshot'), 'off');
  assert.ok(!args.includes('--include-partial-messages'));
  assert.equal(value('--allowedTools'), 'mcp__buzz__*');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(!args.includes('--bare') && !args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes(input.prompt) && !args.includes(input.systemPrompt) && !args.includes(TOKEN));
  const edits = claudeArguments(request({ permissionMode: 'acceptEdits' }), { mcp: 'mcp', system: 'system' });
  assert.equal(edits[edits.indexOf('--permission-mode') + 1], 'acceptEdits');
});

test('private prompt/MCP files contain only needed data and cleanup is idempotent', async (t) => {
  const root = await workspace(t);
  const input = request();
  const files = await createRunFiles(input, { root });
  assert.equal(await readFile(files.system, 'utf8'), input.systemPrompt);
  assert.deepEqual(JSON.parse(await readFile(files.mcp, 'utf8')).mcpServers.buzz.headers, { Authorization: input.mcp.headers[0].value });
  assert.ok(!(await readFile(files.mcp, 'utf8')).includes(TOKEN));
  if (process.platform !== 'win32') {
    assert.equal((await stat(files.directory)).mode & 0o777, 0o700);
    for (const path of [files.mcp, files.system]) assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  await files.cleanup();
  await files.cleanup();
  assert.deepEqual(await readdir(root), []);
});

test('real process exit preserves native results and removes ephemeral files', posix, async (t) => {
  const root = await workspace(t);
  const temporary = join(root, 'temporary');
  await mkdir(temporary);
  const binary = await executable(root, `const fs=require('node:fs'); const a=process.argv; const arg=(f)=>a[a.indexOf(f)+1]; const mcp=JSON.parse(fs.readFileSync(arg('--mcp-config'),'utf8')); if(!mcp.mcpServers.buzz.headers.Authorization || !process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY || arg('--permission-prompts')!=='none') process.exit(9); process.stdin.resume(); process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'result',session_id:arg('--session-id'),is_error:false,result:'complete',permission_denials:[]})+'\\n')});`);
  const input = request();
  const events = [];
  assert.equal(await runClaude(input, { binary, token: TOKEN, emit: async (event) => events.push(event), tempRoot: temporary }), 0);
  assert.deepEqual(events, [{ type: 'bridge_started' }, { type: 'result', session_id: input.sessionId, is_error: false, result: 'complete', permission_denials: [] }]);
  assert.deepEqual(await readdir(temporary), []);
});

test('cancelling a running process waits for exit and removes private files', posix, async (t) => {
  const root = await workspace(t);
  const temporary = join(root, 'temporary');
  await mkdir(temporary);
  const binary = await executable(root, `process.on('SIGTERM',()=>process.exit(0)); process.stdout.write('{"type":"system","subtype":"init"}\\n'); setInterval(()=>{},1000);`);
  const controller = new AbortController();
  await assert.rejects(runClaude(request(), { binary, token: TOKEN, tempRoot: temporary, signal: controller.signal, emit: async () => controller.abort() }), /cancelled/);
  assert.deepEqual(await readdir(temporary), []);
});

test('credential-bearing and malformed child output never reaches the host; all failures clean up', posix, async (t) => {
  const root = await workspace(t);
  const temporary = join(root, 'temporary');
  await mkdir(temporary);
  for (const source of [`process.stdout.write(JSON.stringify({type:'result',result:process.env.CLAUDE_CODE_OAUTH_TOKEN})+'\\n');`, `process.stdout.write('not-json\\n');`, `process.stderr.write(process.env.CLAUDE_CODE_OAUTH_TOKEN);process.exit(1);`]) {
    const binary = await executable(root, source);
    const events = [];
    await assert.rejects(runClaude(request(), { binary, token: TOKEN, tempRoot: temporary, emit: async (event) => events.push(event) }), (error) => {
      assert.ok(!publicError(error).includes(TOKEN));
      assert.ok(!publicError(error).includes('synthetic_buzz_header'));
      return true;
    });
    assert.deepEqual(events, [{ type: 'bridge_started' }]);
    assert.deepEqual(await readdir(temporary), []);
  }
  const events = [];
  await assert.rejects(runClaude(request(), { binary: join(root, 'missing'), token: TOKEN, tempRoot: temporary, emit: async (event) => events.push(event) }), /Unable to start/);
  assert.deepEqual(events, []);
  assert.deepEqual(await readdir(temporary), []);
});

test('managed version pointer cannot select a traversal path', posix, async (t) => {
  const root = await workspace(t);
  const managed = process.platform === 'darwin'
    ? join(root, 'Library', 'Application Support', 'Buzz', 'claude-code')
    : join(root, '.local', 'share', 'buzz', 'claude-code');
  await mkdir(managed, { recursive: true });
  await writeFile(join(managed, 'current'), '../../../malicious\n');
  assert.equal(await resolveClaude(undefined, { home: root, env: { PATH: '', XDG_DATA_HOME: '' } }), null);
  await assert.rejects(resolveClaude('../claude', { home: root, env: { PATH: '' } }), /absolute/);
});

test('model aliases accept only the safe trailing context suffix', () => {
  for (const model of ['sonnet[1m]', 'opus[1m]', 'claude-sonnet-4-6[1m]', 'vendor:model']) {
    assert.equal(validateRequest(request({ model })).model, model);
  }
  for (const model of ['sonnet[2m]', 'sonnet[1m]extra', '[1m]', ' sonnet', 'sonnet ', 'sonnet;quit', 'sonnet[1m][1m]']) {
    assert.throws(() => validateRequest(request({ model })), /Invalid Claude model/);
  }
});

test('Claude version floor handles numeric releases and prerelease boundaries', () => {
  for (const version of ['2.1.100', '2.1.266', '2.1.267-beta', '2.0.999', '1.99.999', 'invalid']) assert.equal(supportedClaudeVersion(version), false, version);
  for (const version of [MIN_CLAUDE_VERSION, '2.1.323', '2.2.0', '3.0.0']) assert.equal(supportedClaudeVersion(version), true, version);
});

test('discovery rejects an explicit old CLI but skips old PATH candidates', posix, async (t) => {
  const root = await workspace(t);
  const old = join(root, 'old');
  const current = join(root, 'current');
  await mkdir(old);
  await mkdir(current);
  const oldBinary = await executable(old, `console.log('2.1.100 (Claude Code)');`, 'claude');
  const currentBinary = await executable(current, `console.log('2.1.267 (Claude Code)');`, 'claude');
  await assert.rejects(resolveClaude(oldBinary), /configured.*2\.1\.100.*2\.1\.267/);
  assert.deepEqual(await resolveClaude(undefined, { home: root, env: { PATH: [old, current].join(delimiter) } }), { binary: currentBinary, version: '2.1.267' });
  await assert.rejects(resolveClaude(undefined, { home: root, env: { PATH: old } }), /outdated.*2\.1\.267/);
});

test('nonzero structured results retain their subtype, explanation, denials, and numeric exit', posix, async (t) => {
  const root = await workspace(t);
  const result = { type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Maximum turns reached; increase the turn limit.', permission_denials: [{ tool_name: 'Bash' }] };
  const binary = await executable(root, `process.stdout.write(${JSON.stringify(JSON.stringify(result) + '\n')},()=>process.exit(7));`);
  const events = [];
  const code = await runClaude(request(), { binary, token: TOKEN, tempRoot: root, emit: async (event) => events.push(event) });
  assert.equal(code, 7);
  assert.deepEqual(events, [{ type: 'bridge_started' }, result]);
});

test('bridge entrypoint propagates structured failure exits without a generic bridge error', { skip: process.platform !== 'linux' ? 'Uses an isolated Linux secret-tool executable fixture, never the real credential store.' : false }, async (t) => {
  const root = await workspace(t);
  await executable(root, `process.stdout.write(${JSON.stringify(TOKEN)});`, 'secret-tool');
  const result = { type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Turn limit reached.', permission_denials: [{ tool_name: 'Bash' }] };
  const binary = await executable(root, `if(process.argv.includes('--version')) { console.log('2.1.267 (Claude Code)'); } else { process.stdin.resume(); process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(result) + '\n')},()=>process.exit(7))); }`);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/bridge-cli.mjs', import.meta.url))], { env: { ...isolatedEnv(), PATH: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.resume();
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  child.stdin.end(JSON.stringify(request({ binary })));
  assert.equal(await closed, 7);
  assert.deepEqual(Buffer.concat(chunks).toString('utf8').trim().split('\n').map((line) => JSON.parse(line)), [{ type: 'bridge_started' }, result]);
});

test('pre-spawn cancellation never emits the turn-start marker', posix, async (t) => {
  const root = await workspace(t);
  const controller = new AbortController();
  controller.abort();
  const events = [];
  await assert.rejects(runClaude(request(), { binary: join(root, 'missing'), token: TOKEN, tempRoot: root, signal: controller.signal, emit: async (event) => events.push(event) }), /cancelled/);
  assert.deepEqual(events, []);
  assert.deepEqual(await readdir(root), []);
});

test('status discovers credentials and CLI independently, preserving safe actionable errors', async () => {
  const cli = { binary: '/fixture/claude', version: MIN_CLAUDE_VERSION };
  assert.deepEqual(await connectionStatus(undefined, { tokenLookup: async () => { throw new BridgeError('Unlock your desktop keyring.'); }, cliLookup: async () => cli }), { tokenStored: false, ...cli, credentialError: 'Unlock your desktop keyring.' });
  assert.deepEqual(await connectionStatus(undefined, { tokenLookup: async () => TOKEN, cliLookup: async () => { throw new BridgeError(`Install Claude Code ${MIN_CLAUDE_VERSION} or newer.`); } }), { tokenStored: true, binary: null, version: null, cliError: `Install Claude Code ${MIN_CLAUDE_VERSION} or newer.` });
  const failed = await connectionStatus(undefined, { tokenLookup: async () => { throw new Error(TOKEN); }, cliLookup: async () => null });
  assert.equal(failed.tokenStored, false);
  assert.equal(failed.binary, null);
  assert.match(failed.cliError, /Install Claude Code/);
  assert.ok(!failed.credentialError.includes(TOKEN));
});

async function staleDirectory(root, name, contents = { 'system.txt': 'private prompt', 'mcp.json': '{}' }) {
  const directory = join(root, name);
  await mkdir(directory, { mode: 0o700 });
  const old = new Date(Date.now() - STALE_RUN_AGE - 60000);
  for (const [file, value] of Object.entries(contents)) {
    await writeFile(join(directory, file), value, { mode: 0o600 });
    await utimes(join(directory, file), old, old);
  }
  await utimes(directory, old, old);
  return directory;
}

test('startup removes stale residue but preserves fresh, live, unrelated and uncertain directories', async (t) => {
  const root = await workspace(t);
  const stale = await staleDirectory(root, 'buzz-claude-subscription-stale1');
  const fresh = await createRunFiles(request(), { root });
  const live = await staleDirectory(root, 'buzz-claude-subscription-live01', { 'run-owner.json': JSON.stringify({ pid: process.pid }) });
  const unknown = await staleDirectory(root, 'buzz-claude-subscription-other1', { 'unrelated.txt': 'retain' });
  const malformed = await staleDirectory(root, 'buzz-claude-subscription-badpid', { 'run-owner.json': '{invalid' });
  const unrelated = await staleDirectory(root, 'unrelated-stale-directory');
  const nested = await staleDirectory(root, 'buzz-claude-subscription-nested', {});
  await mkdir(join(nested, 'system.txt'));
  const linked = join(root, 'buzz-claude-subscription-link01');
  await symlink(unrelated, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await cleanupStaleRunFiles({ root });
  await assert.rejects(stat(stale), { code: 'ENOENT' });
  for (const directory of [fresh.directory, live, unknown, malformed, unrelated, nested, linked]) assert.ok((await stat(directory)).isDirectory());
  assert.equal(await readFile(join(unrelated, 'system.txt'), 'utf8'), 'private prompt');
});

test('stale cleanup refuses linked files and access failures', posix, async (t) => {
  const root = await workspace(t);
  const target = join(root, 'private.txt');
  await writeFile(target, 'retain');
  const linked = await staleDirectory(root, 'buzz-claude-subscription-link02', {});
  await symlink(target, join(linked, 'system.txt'));
  const old = new Date(Date.now() - STALE_RUN_AGE - 60000);
  await utimes(linked, old, old);
  const inaccessible = await staleDirectory(root, 'buzz-claude-subscription-denied');
  await chmod(inaccessible, 0);
  try {
    await cleanupStaleRunFiles({ root });
    assert.equal(await readFile(target, 'utf8'), 'retain');
    assert.ok((await stat(linked)).isDirectory());
    if (process.getuid() !== 0) assert.ok((await stat(inaccessible)).isDirectory());
  } finally {
    await chmod(inaccessible, 0o700).catch(() => {});
  }
});

test('stale cleanup preserves foreign ownership', { skip: process.platform === 'win32' || process.getuid?.() !== 0 ? 'Changing fixture ownership requires a POSIX root test runner.' : false }, async (t) => {
  const root = await workspace(t);
  const foreign = await staleDirectory(root, 'buzz-claude-subscription-owner1');
  await chown(foreign, 65534, 65534);
  await cleanupStaleRunFiles({ root });
  assert.ok((await stat(foreign)).isDirectory());
});

test('a new run performs stale cleanup before spawning Claude', posix, async (t) => {
  const root = await workspace(t);
  const stale = await staleDirectory(root, 'buzz-claude-subscription-stale2');
  const binary = await executable(root, `console.log('{"type":"result","is_error":false,"result":"complete"}');`);
  await runClaude(request(), { binary, token: TOKEN, tempRoot: root, emit: async () => {} });
  await assert.rejects(stat(stale), { code: 'ENOENT' });
  assert.deepEqual(await readdir(root), ['claude-fixture']);
});
