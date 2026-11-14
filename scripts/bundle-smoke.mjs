import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// This is the exact compiled source embedded in plugin.js, not a second build.
// Exercise the native command-line/stdio boundary, including Windows quoting.
const source = await readFile(new URL('../.build/bridge.cjs', import.meta.url), 'utf8');
async function request(value) {
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let bytes = 0;
  let timedOut = false;
  const collect = chunk => {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) child.kill('SIGKILL');
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { collect(chunk); if (bytes <= 1024 * 1024) stdout += chunk; });
  child.stderr.on('data', collect);
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 45000);
  try {
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => resolve(code));
    });
    child.stdin.end(JSON.stringify(value));
    const code = await closed;
    assert.equal(timedOut, false, 'Bundled bridge timed out');
    assert.ok(bytes <= 1024 * 1024, 'Bundled bridge exceeded the smoke output bound');
    const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { code, events, stdout };
  } finally {
    clearTimeout(timer);
  }
}

const status = await request({ action: 'status' });
assert.equal(status.code, 0, 'Bundled status request failed');
assert.equal(status.events.length, 1);
assert.equal(status.events[0].type, 'bridge_status');
assert.equal(typeof status.events[0].tokenStored, 'boolean');

const invalid = 'not-an-oauth-token';
const rejected = await request({ action: 'save', token: invalid });
assert.equal(rejected.code, 1, 'Invalid credential request must fail before storage');
assert.equal(rejected.events.length, 1);
assert.equal(rejected.events[0].type, 'bridge_error');
assert.equal(rejected.stdout.includes(invalid), false, 'Rejected credential must not be echoed');
console.log(`Bundled node -e status and invalid-input checks passed (${process.platform}/${process.arch}).`);
