import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BridgeError, LIMITS, claudeArguments, createRunFiles, expandPath, isolatedEnv, publicError, readRequest, resolveClaude, runClaude, validateRequest, validateToken } from '../src/bridge.mjs';

const TOKEN = 'sk-ant-oat01-synthetic_non_authentication_token_123456789';
const request = (changes = {}) => ({ action: 'run', prompt: 'Test prompt', systemPrompt: 'Test instructions', sessionId: randomUUID(), resume: false, mcp: { url: 'http://127.0.0.1:1234/mcp', headers: [{ name: 'Authorization', value: 'Bearer synthetic_buzz_header' }] }, permissionMode: 'default', cwd: tmpdir(), ...changes });

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'buzz-bridge-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// An executable adversarial fixture exercises real OS pipes, signals and files, not a
// credential adapter substitute. Production always resolves the installed Claude CLI.
async function executable(root, source) {
  const file = join(root, 'claude-fixture');
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
  await runClaude(input, { binary, token: TOKEN, emit: async (event) => events.push(event), tempRoot: temporary });
  assert.deepEqual(events, [{ type: 'result', session_id: input.sessionId, is_error: false, result: 'complete', permission_denials: [] }]);
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
    await assert.rejects(runClaude(request(), { binary, token: TOKEN, tempRoot: temporary, emit: async (event) => events.push(event) }));
    assert.deepEqual(events, []);
    assert.deepEqual(await readdir(temporary), []);
  }
  await assert.rejects(runClaude(request(), { binary: join(root, 'missing'), token: TOKEN, tempRoot: temporary, emit: async () => {} }));
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
