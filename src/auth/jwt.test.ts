import assert from 'node:assert/strict';
import test from 'node:test';
import {
  signRefreshToken,
  verifyRefreshToken,
} from './jwt.js';

test('refresh tokens issued for the same account in one second remain unique and valid', () => {
  const payload = { userId: 'same-user', app: 'installhub' as const };

  const first = signRefreshToken(payload);
  const second = signRefreshToken(payload);

  assert.notEqual(first, second);
  const firstPayload = verifyRefreshToken(first) as (
    ReturnType<typeof verifyRefreshToken> & { jti?: string }
  );
  const secondPayload = verifyRefreshToken(second) as (
    ReturnType<typeof verifyRefreshToken> & { jti?: string }
  );
  assert.equal(firstPayload?.userId, payload.userId);
  assert.equal(firstPayload?.app, payload.app);
  assert.equal(secondPayload?.userId, payload.userId);
  assert.equal(secondPayload?.app, payload.app);
  assert.match(firstPayload?.jti ?? '', /^[0-9a-f-]{36}$/);
  assert.match(secondPayload?.jti ?? '', /^[0-9a-f-]{36}$/);
  assert.notEqual(firstPayload?.jti, secondPayload?.jti);
});
