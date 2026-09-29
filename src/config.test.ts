import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEcoAuditCommandHmacSecret } from './config.js';

test('EcoAudit command recovery secret is long-lived and distinct from JWT keys', () => {
  const jwt = 'jwt-signing-secret-012345678901234567890';
  const refresh = 'jwt-refresh-secret-012345678901234567890';
  const command = 'ecoaudit-command-secret-012345678901234567890';

  assert.equal(parseEcoAuditCommandHmacSecret(command, jwt, refresh), command);
  assert.throws(
    () => parseEcoAuditCommandHmacSecret(undefined, jwt, refresh),
    /Missing required environment variable: ECOAUDIT_COMMAND_HMAC_SECRET/,
  );
  assert.throws(
    () => parseEcoAuditCommandHmacSecret('too-short', jwt, refresh),
    /must contain at least 32 characters/,
  );
  assert.throws(
    () => parseEcoAuditCommandHmacSecret(jwt, jwt, refresh),
    /must be distinct from JWT secrets/,
  );
  assert.throws(
    () => parseEcoAuditCommandHmacSecret(refresh, jwt, refresh),
    /must be distinct from JWT secrets/,
  );
});
