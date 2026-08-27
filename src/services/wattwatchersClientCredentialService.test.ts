import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptWattwatchersClientKey,
  encryptWattwatchersClientKey,
} from './wattwatchersClientCredentialService.js';

test('client API keys are authenticated, client-bound, and never stored as plaintext', () => {
  const secret = 'test-only-client-credential-secret';
  const encrypted = encryptWattwatchersClientKey('client-a', 'ww-secret-key', secret);
  assert.notEqual(encrypted.ciphertext, 'ww-secret-key');
  assert.equal(decryptWattwatchersClientKey('client-a', encrypted, secret), 'ww-secret-key');
  assert.throws(
    () => decryptWattwatchersClientKey('client-b', encrypted, secret),
    /cannot be opened/,
  );
});
