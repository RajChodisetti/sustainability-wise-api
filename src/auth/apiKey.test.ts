import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKey, verifyKey } from './apiKey.js';
import { apiKeyIsCurrent } from './middleware.js';

test('API key prefixes remain isolated for all three applications', async () => {
  for (const [app, prefix] of [
    ['ecoaudit', 'sk_ea_live_'],
    ['solarsense', 'sk_ss_live_'],
    ['wattwatchers', 'sk_ww_live_'],
  ] as const) {
    const generated = generateKey(app);
    assert.equal(generated.prefix, prefix);
    assert.match(generated.raw, new RegExp(`^${prefix}`));
    assert.equal(await verifyKey(generated.raw, await generated.hashed), true);
  }
});

test('expired or revoked API keys are rejected while non-expiring keys remain valid', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  assert.equal(apiKeyIsCurrent({ revokedAt: null, expiresAt: null }, now), true);
  assert.equal(apiKeyIsCurrent({
    revokedAt: null, expiresAt: new Date('2026-07-15T12:00:01.000Z'),
  }, now), true);
  assert.equal(apiKeyIsCurrent({
    revokedAt: null, expiresAt: new Date('2026-07-15T11:59:59.000Z'),
  }, now), false);
  assert.equal(apiKeyIsCurrent({
    revokedAt: new Date('2026-07-15T11:00:00.000Z'), expiresAt: null,
  }, now), false);
});
