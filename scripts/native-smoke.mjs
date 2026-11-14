import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { credentialOperation } from '../src/bridge.mjs';

// Unique namespace: never read, replace, or delete the user's actual token.
const scope = { service: `kvncrw.buzz-claude-test.${randomUUID()}`, account: 'oauth-token' };
const first = `sk-ant-oat01-SYNTHETIC_NOT_AN_AUTH_TOKEN_${randomUUID().replaceAll('-', '')}`;
const replacement = `sk-ant-oat01-SYNTHETIC_REPLACEMENT_${randomUUID().replaceAll('-', '')}`;
try {
  assert.equal(await credentialOperation('lookup', scope), null, 'New test namespace must be absent');
  await credentialOperation('save', { ...scope, token: first });
  assert.ok((await credentialOperation('lookup', scope)) === first, 'Native store did not round-trip the token');
  await credentialOperation('save', { ...scope, token: replacement });
  assert.ok((await credentialOperation('lookup', scope)) === replacement, 'Native store did not replace the token');
} finally {
  await credentialOperation('remove', scope);
}
assert.equal(await credentialOperation('lookup', scope), null, 'Removed token must be absent');
console.log(`Native credential save/read/replace/remove passed (${process.platform}/${process.arch}); isolated test entry removed.`);
