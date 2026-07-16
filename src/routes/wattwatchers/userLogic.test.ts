import assert from 'node:assert/strict';
import test from 'node:test';
import { adminRemovalGuard } from './userLogic.js';

const base = {
  actorId: 'admin-a',
  targetId: 'admin-b',
  currentRole: 'admin',
  currentIsActive: true,
  nextRole: 'viewer',
  nextIsActive: true,
};

test('admins cannot demote or deactivate themselves', () => {
  assert.equal(adminRemovalGuard({
    ...base, targetId: 'admin-a', activeAdminCount: 2,
  }), 'self');
});

test('the last active Fleet administrator cannot be removed', () => {
  assert.equal(adminRemovalGuard({ ...base, activeAdminCount: 1 }), 'last_admin');
  assert.equal(adminRemovalGuard({ ...base, activeAdminCount: 2 }), null);
});
