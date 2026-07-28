import assert from 'node:assert/strict';
import test from 'node:test';
import {
  editableFieldMembership,
  filterUnifiedPortalUsers,
  membershipForApp,
} from './unifiedUsers';
import type { UnifiedPortalUser } from '../types/domain';

const users: UnifiedPortalUser[] = [
  {
    key: 'linked-user',
    identityIds: ['ea-1', 'ih-projection-1'],
    displayEmail: 'alex@example.com',
    fullName: 'Alex Auditor',
    candidateKey: 'alex@example.com',
    possibleDuplicateCount: 0,
    syncStatus: 'synced',
    memberships: [
      {
        app: 'ecoaudit',
        userId: 'ea-1',
        identityId: 'identity-ea-1',
        email: 'alex@example.com',
        fullName: 'Alex Auditor',
        role: 'admin',
        isActive: true,
        isSourceProjection: false,
        sourceApp: null,
        sourceUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        app: 'installhub',
        userId: 'ih-projection-1',
        identityId: 'identity-ea-1',
        email: 'alex@example.com',
        fullName: 'Alex Auditor',
        role: 'admin',
        isActive: true,
        isSourceProjection: true,
        sourceApp: 'ecoaudit',
        sourceUserId: 'ea-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    key: 'solar-user',
    identityIds: ['ss-1', 'ih-projection-2'],
    displayEmail: 'sam@example.com',
    fullName: 'Sam Solar',
    candidateKey: 'sam@example.com',
    possibleDuplicateCount: 1,
    syncStatus: 'drifted',
    memberships: [
      {
        app: 'solarsense',
        userId: 'ss-1',
        identityId: 'identity-ss-1',
        email: 'sam@example.com',
        fullName: 'Sam Solar',
        role: 'inspector',
        isActive: false,
        isSourceProjection: false,
        sourceApp: null,
        sourceUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        app: 'installhub',
        userId: 'ih-projection-2',
        identityId: 'identity-ss-1',
        email: 'sam@example.com',
        fullName: 'Sam Solar',
        role: 'inspector',
        isActive: true,
        isSourceProjection: true,
        sourceApp: 'solarsense',
        sourceUserId: 'ss-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    key: 'field-user',
    identityIds: ['ih-1'],
    displayEmail: 'field@example.com',
    fullName: 'Field Only',
    candidateKey: 'field@example.com',
    possibleDuplicateCount: 0,
    syncStatus: 'field_only',
    memberships: [
      {
        app: 'installhub',
        userId: 'ih-1',
        identityId: 'identity-ih-1',
        email: 'field@example.com',
        fullName: 'Field Only',
        role: 'inspector',
        isActive: true,
        isSourceProjection: false,
        sourceApp: null,
        sourceUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
];

test('finds a membership by application', () => {
  assert.equal(membershipForApp(users[0], 'ecoaudit')?.userId, 'ea-1');
  assert.equal(membershipForApp(users[0], 'solarsense'), undefined);
});

test('search includes hidden Solar Sense membership fields and sync state', () => {
  assert.deepEqual(
    filterUnifiedPortalUsers(users, 'Solar Sense').map((user) => user.key),
    ['solar-user'],
  );
  assert.deepEqual(
    filterUnifiedPortalUsers(users, 'needs attention').map((user) => user.key),
    ['solar-user'],
  );
  assert.deepEqual(
    filterUnifiedPortalUsers(users, 'field only').map((user) => user.key),
    ['field-user'],
  );
  assert.deepEqual(
    filterUnifiedPortalUsers(users, 'administrator').map((user) => user.key),
    ['linked-user'],
  );
});

test('only a direct field-only membership can use the legacy editor', () => {
  assert.equal(editableFieldMembership(users[2])?.userId, 'ih-1');
  assert.equal(editableFieldMembership(users[0]), undefined);
  assert.equal(editableFieldMembership(users[1]), undefined);
});
