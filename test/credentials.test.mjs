import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialCommand } from '../src/credentials.mjs';

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
