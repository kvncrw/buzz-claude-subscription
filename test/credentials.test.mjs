import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialCommand as commandForPlatform } from '../src/credentials.mjs';
import { publicError } from '../src/bridge.mjs';
import { windowsHelper } from '../src/native-platform.mjs';

const credentialCommand = (platform, action, token, options) => commandForPlatform(platform, action, token, { env: { SystemRoot: 'C:\\Windows' }, ...options });

const TOKEN = 'sk-ant-oat01-synthetic_non_authentication_token_123456789';

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`${platform}: credential material is stdin-only; no shell command or argument interpolation`, () => {
    const command = credentialCommand(platform, 'save', TOKEN);
    assert.ok(command.input.includes(TOKEN));
    assert.ok(!command.binary.includes(TOKEN));
    assert.ok(command.args.every((argument) => !argument.includes(TOKEN)));
    assert.equal(command.env, undefined);
    assert.equal(command.shell, undefined);
    for (const invalid of [`${TOKEN}\nquit`, `${TOKEN}"`, `${TOKEN};`, `${TOKEN} `]) assert.throws(() => credentialCommand(platform, 'save', invalid));
    for (const action of ['lookup', 'remove']) {
      const operation = credentialCommand(platform, action);
      assert.ok(!operation.input.includes(TOKEN));
      assert.ok(operation.args.every((argument) => !argument.includes(TOKEN)));
    }
  });
}


test('Windows credentials reject oversized values before reaching the OS', () => {
  assert.throws(() => credentialCommand('win32', 'save', `sk-ant-oat01-${'a'.repeat(2560)}`), /size limit/);
});

test('macOS rejects an oversized interactive command before it can truncate a saved token', () => {
  const prefix = 'sk-ant-oat01-';
  const overhead = Buffer.byteLength(credentialCommand('darwin', 'save', TOKEN).input) - TOKEN.length;
  const fits = prefix + 'a'.repeat(4095 - overhead - prefix.length);
  assert.equal(Buffer.byteLength(credentialCommand('darwin', 'save', fits).input), 4095);
  assert.throws(() => credentialCommand('darwin', 'save', fits + 'a'), /input limit/);
});

test('credential namespaces reject option, shell, and path injection', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const value of ['bad name', '-option', 'bad\ncommand', 'bad"quote', '../traversal']) {
      assert.throws(() => credentialCommand(platform, 'save', TOKEN, { service: value }));
      assert.throws(() => credentialCommand(platform, 'save', TOKEN, { account: value }));
    }
  }
});

test('unsupported platforms fail closed rather than selecting another credential backend', () => {
  for (const platform of ['freebsd', 'openbsd', 'aix', '', undefined]) {
    for (const action of ['lookup', 'save', 'remove']) assert.throws(() => credentialCommand(platform, action, action === 'save' ? TOKEN : undefined), /Unsupported credential platform/);
  }
});

test('safe credential errors retain remediation without exposing submitted tokens or namespaces', () => {
  const cases = [
    ['win32', 'save', `sk-ant-oat01-${'a'.repeat(2560)}`, {}, /Windows Credential Manager size limit/],
    ['darwin', 'save', `sk-ant-oat01-${'a'.repeat(5000)}`, {}, /Keychain helper input limit/],
    ['linux', 'save', `${TOKEN}\ninvalid`, {}, /valid long-lived Claude OAuth token/],
    ['linux', 'lookup', undefined, { service: TOKEN + '\ninvalid' }, /Invalid credential namespace/],
    ['unsupported', 'lookup', undefined, {}, /Supported platforms/],
  ];
  for (const [platform, action, token, options, expected] of cases) {
    assert.throws(() => credentialCommand(platform, action, token, options), (error) => {
      assert.match(publicError(error), expected);
      assert.ok(!publicError(error).includes(TOKEN));
      if (token) assert.ok(!publicError(error).includes(token));
      return true;
    });
  }
  assert.ok(!publicError(new Error(`helper stderr: ${TOKEN}`)).includes(TOKEN));
});

test('Windows helpers resolve under absolute System32 rather than PATH or the working directory', () => {
  const env = { sYsTeMrOoT: 'D:\\OS', PATH: 'C:\\untrusted', WINDIR: 'C:\\untrusted' };
  assert.equal(windowsHelper('powershell', env), 'D:\\OS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(windowsHelper('icacls', env), 'D:\\OS\\System32\\icacls.exe');
  assert.equal(credentialCommand('win32', 'lookup', undefined, { env }).binary, windowsHelper('powershell', env));
  for (const SystemRoot of [undefined, '', '.', 'C:Windows', '\\\\server\\share', 'C:\\Windows\\..\\untrusted', 'C:\\Windows\n']) {
    assert.throws(() => windowsHelper('powershell', { SystemRoot }), /SystemRoot/);
  }
  assert.throws(() => windowsHelper('../untrusted', env), /Unsupported/);
});
