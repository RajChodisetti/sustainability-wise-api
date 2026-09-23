import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEcoAuditUserCreateBody,
  cloudEmailForEcoAuditUser,
} from './userProvisioning';

test('builds an ID-safe EcoAudit provisioning request for a legacy local user', () => {
  assert.deepEqual(buildEcoAuditUserCreateBody({
    fullName: '  Harsha Kumar  ',
    usernameOrEmail: '  Harsha.KBSS  ',
    password: 'secret1',
    role: 'inspector',
    legacyLocalId: '  550e8400-e29b-41d4-a716-446655440000  ',
  }), {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'harsha.kbss@ecoaudit.users.local',
    password: 'secret1',
    fullName: 'Harsha Kumar',
    role: 'inspector',
  });
});

test('omits a blank legacy ID and preserves a normalized real email', () => {
  assert.deepEqual(buildEcoAuditUserCreateBody({
    fullName: 'Harsha Kumar',
    usernameOrEmail: ' Harsha@Example.COM ',
    password: 'secret1',
    role: 'admin',
    legacyLocalId: '   ',
  }), {
    email: 'harsha@example.com',
    password: 'secret1',
    fullName: 'Harsha Kumar',
    role: 'admin',
  });
});

test('uses the same safe username conversion as the mobile app', () => {
  assert.equal(
    cloudEmailForEcoAuditUser('Audit User'),
    'audit-user@ecoaudit.users.local',
  );
});

test('rejects short passwords and malformed legacy IDs before the API call', () => {
  assert.throws(
    () => buildEcoAuditUserCreateBody({
      fullName: 'Harsha Kumar',
      usernameOrEmail: 'harsha',
      password: 'short',
      role: 'inspector',
    }),
    /Password must be at least 6 characters/u,
  );
  assert.throws(
    () => buildEcoAuditUserCreateBody({
      fullName: 'Harsha Kumar',
      usernameOrEmail: 'harsha',
      password: 'secret1',
      role: 'inspector',
      legacyLocalId: 'not-a-uuid',
    }),
    /Legacy local account ID must be a valid UUID/u,
  );
});
