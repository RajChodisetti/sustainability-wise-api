import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSyncCreatedByUserId } from './syncOwnership.js';

test('non-elevated sync cannot spoof a new parent creator', () => {
  assert.equal(resolveSyncCreatedByUserId({
    existingRecord: false,
    existingCreatedByUserId: undefined,
    incomingCreatedByUserId: 'victim',
    actor: { userId: 'attacker', role: 'inspector' },
  }), 'attacker');
});

test('sync preserves existing creator and allows elevated trusted imports', () => {
  assert.equal(resolveSyncCreatedByUserId({
    existingRecord: true,
    existingCreatedByUserId: 'original-owner',
    incomingCreatedByUserId: 'replacement',
    actor: { userId: 'admin', role: 'admin' },
  }), 'original-owner');
  assert.equal(resolveSyncCreatedByUserId({
    existingRecord: false,
    existingCreatedByUserId: undefined,
    incomingCreatedByUserId: 'imported-owner',
    actor: { userId: 'service', role: 'service_account' },
  }), 'imported-owner');
});
