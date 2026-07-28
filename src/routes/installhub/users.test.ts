import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthUser } from '../../auth/middleware.js';
import {
  installHubAdminRemovalGuard,
  installHubPasswordChangeMode,
} from './helpers.js';

const adminActor: AuthUser = {
  userId: 'admin-a',
  app: 'installhub',
  role: 'admin',
  authType: 'jwt',
};

test('InstallHub administrators cannot demote or deactivate themselves', () => {
  assert.equal(installHubAdminRemovalGuard({
    actorId: 'admin-a',
    targetId: 'admin-a',
    currentRole: 'admin',
    currentIsActive: true,
    nextRole: 'inspector',
    nextIsActive: true,
    activeAdminCount: 2,
  }), 'self');
  assert.equal(installHubAdminRemovalGuard({
    actorId: 'admin-a',
    targetId: 'admin-a',
    currentRole: 'admin',
    currentIsActive: true,
    nextRole: 'admin',
    nextIsActive: false,
    activeAdminCount: 2,
  }), 'self');
});

test('InstallHub keeps at least one active administrator', () => {
  const removal = {
    actorId: 'admin-a',
    targetId: 'admin-b',
    currentRole: 'admin',
    currentIsActive: true,
    nextRole: 'inspector',
    nextIsActive: true,
  };
  assert.equal(installHubAdminRemovalGuard({
    ...removal,
    activeAdminCount: 1,
  }), 'last_admin');
  assert.equal(installHubAdminRemovalGuard({
    ...removal,
    activeAdminCount: 2,
  }), null);
});

test('editing a user without removing an active admin is allowed', () => {
  assert.equal(installHubAdminRemovalGuard({
    actorId: 'admin-a',
    targetId: 'inspector-a',
    currentRole: 'inspector',
    currentIsActive: true,
    nextRole: 'inspector',
    nextIsActive: false,
    activeAdminCount: 1,
  }), null);
});

test('password changes distinguish self-service from deliberate admin reset', () => {
  assert.equal(
    installHubPasswordChangeMode('admin-a', adminActor),
    'self',
  );
  assert.equal(
    installHubPasswordChangeMode('inspector-a', adminActor),
    'admin_reset',
  );
});

test('synthetic source subjects use self-service only for their own Field session', () => {
  const sourceAdminActor: AuthUser = {
    userId: 'unified-field:ecoaudit:eco-admin',
    app: 'installhub',
    role: 'admin',
    authType: 'jwt',
  };
  assert.equal(
    installHubPasswordChangeMode(
      'unified-field:ecoaudit:eco-admin',
      sourceAdminActor,
    ),
    'self',
  );
  assert.equal(
    installHubPasswordChangeMode(
      'unified-field:solarsense:solar-user',
      sourceAdminActor,
    ),
    'admin_reset',
  );
});

test('inspectors cannot reset another InstallHub user password', () => {
  const inspectorActor: AuthUser = {
    userId: 'inspector-a',
    app: 'installhub',
    role: 'inspector',
    authType: 'jwt',
  };
  assert.throws(
    () => installHubPasswordChangeMode('inspector-b', inspectorActor),
    (error: unknown) => (
      error instanceof Error
      && 'statusCode' in error
      && error.statusCode === 403
    ),
  );
});
