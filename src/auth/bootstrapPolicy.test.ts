import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import { planLocalBootstrap } from './bootstrapPolicy.js';

test('new bootstrap accounts are always inspectors regardless of client intent', () => {
  assert.deepEqual(planLocalBootstrap({
    existing: null,
    requestedEmail: 'installer@installhub.users.local',
    allowLegacyUpsert: false,
  }), { mode: 'create', role: 'inspector' });
});

test('existing accounts cannot be overwritten unless the rollback bridge is explicit', () => {
  const existing = {
    email: 'installer@installhub.users.local',
    role: 'admin',
    isActive: true,
  };
  assert.throws(
    () => planLocalBootstrap({
      existing,
      requestedEmail: existing.email,
      allowLegacyUpsert: false,
    }),
    (error) => error instanceof AppError && error.statusCode === 409,
  );
  assert.deepEqual(planLocalBootstrap({
    existing,
    requestedEmail: existing.email,
    allowLegacyUpsert: true,
  }), { mode: 'legacy-update', role: 'admin' });
});

test('legacy mode cannot reactivate an account or rebind its email', () => {
  assert.throws(
    () => planLocalBootstrap({
      existing: {
        email: 'installer@installhub.users.local',
        role: 'inspector',
        isActive: false,
      },
      requestedEmail: 'installer@installhub.users.local',
      allowLegacyUpsert: true,
    }),
    (error) => error instanceof AppError && error.statusCode === 403,
  );
  assert.throws(
    () => planLocalBootstrap({
      existing: {
        email: 'installer@installhub.users.local',
        role: 'inspector',
        isActive: true,
      },
      requestedEmail: 'attacker@installhub.users.local',
      allowLegacyUpsert: true,
    }),
    (error) => error instanceof AppError && error.statusCode === 409,
  );
});
