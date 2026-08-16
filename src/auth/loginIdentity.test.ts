import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudEmailForLogin,
  explicitFieldEmailForLogin,
  fieldBridgeIdentity,
  fleetBridgeIdentity,
  globalLoginKey,
  selectFieldLoginAuthority,
  selectFleetLoginAuthority,
  sourceIdentitiesForFieldLogin,
  sourceIdentitiesForFleetLogin,
  verifyActiveLogin,
  verifyFieldSourceUser,
  verifyFleetSourceAdmin,
  verifyGlobalLoginIdentity,
} from './loginIdentity.js';

test('global login keys collapse product-local aliases but retain real emails', () => {
  assert.equal(globalLoginKey(' Raj '), 'username:raj');
  assert.equal(globalLoginKey('raj@ecoaudit.users.local'), 'username:raj');
  assert.equal(globalLoginKey('raj@solarsense.users.local'), 'username:raj');
  assert.equal(globalLoginKey('raj@installhub.users.local'), 'username:raj');
  assert.equal(globalLoginKey('Admin@Example.com'), 'email:admin@example.com');
  assert.equal(
    globalLoginKey('raj@wattwatchers.users.local'),
    'email:raj@wattwatchers.users.local',
  );
});

test('global login accepts preserved hashes for one identity', async () => {
  const resolved = await verifyGlobalLoginIdentity([
    { globalUserId: 'global-1', passwordHash: 'eco-hash', isActive: true },
    { globalUserId: 'global-1', passwordHash: 'solar-hash', isActive: true },
  ], 'old-solar-password', async (password, hash) => (
    password === 'old-solar-password' && hash === 'solar-hash'
  ));
  assert.deepEqual(resolved, {
    globalUserId: 'global-1',
    passwordHash: 'solar-hash',
  });
});

test('same-key identities accepting the same password fail closed', async () => {
  const resolved = await verifyGlobalLoginIdentity([
    { globalUserId: 'global-1', passwordHash: 'hash-1', isActive: true },
    { globalUserId: 'global-2', passwordHash: 'hash-2', isActive: true },
  ], 'shared-password', async () => true);
  assert.equal(resolved, null);
});

test('missing and inactive global identities still verify a dummy credential', async () => {
  const checkedHashes: string[] = [];
  const verifier = async (_password: string, hash: string) => {
    checkedHashes.push(hash);
    return true;
  };
  assert.equal(await verifyGlobalLoginIdentity([], 'password', verifier), null);
  assert.equal(await verifyGlobalLoginIdentity([
    { globalUserId: 'inactive', passwordHash: 'inactive-real-hash', isActive: false },
  ], 'password', verifier), null);
  assert.equal(checkedHashes.length, 2);
  assert.ok(checkedHashes.every((hash) => hash !== 'inactive-real-hash'));
});

test('Wattwatchers usernames retain their explicit app identity', () => {
  assert.equal(cloudEmailForLogin('wattwatchers', ' Raj '), 'raj@wattwatchers.users.local');
  assert.equal(cloudEmailForLogin('wattwatchers', 'Admin@Example.com'), 'admin@example.com');
});

test('plain and app-local usernames resolve to one Fleet identity and both source identities', () => {
  for (const login of [' Raj ', 'raj@ecoaudit.users.local', 'raj@solarsense.users.local']) {
    assert.deepEqual(sourceIdentitiesForFleetLogin(login), {
      fleetEmail: 'raj@wattwatchers.users.local',
      sources: [
        { app: 'ecoaudit', email: 'raj@ecoaudit.users.local' },
        { app: 'solarsense', email: 'raj@solarsense.users.local' },
      ],
    });
  }

  assert.deepEqual(sourceIdentitiesForFleetLogin('Admin@Example.com'), {
    fleetEmail: 'admin@example.com',
    sources: [
      { app: 'ecoaudit', email: 'admin@example.com' },
      { app: 'solarsense', email: 'admin@example.com' },
    ],
  });
});

test('source-linked shadows have deterministic identities separate from human logins', () => {
  const ecoBridge = fleetBridgeIdentity({ app: 'ecoaudit', id: 'source-user-1' });
  assert.deepEqual(ecoBridge, fleetBridgeIdentity({ app: 'ecoaudit', id: 'source-user-1' }));
  assert.notDeepEqual(ecoBridge, fleetBridgeIdentity({ app: 'solarsense', id: 'source-user-1' }));
  assert.match(ecoBridge.email, /^bridge-[a-f0-9]{32}@wattwatchers\.users\.local$/);
});

test('Field login resolves legacy aliases while retaining an explicit source hint', () => {
  assert.deepEqual(sourceIdentitiesForFieldLogin(' Raj '), {
    fieldEmail: 'raj@installhub.users.local',
    sourceHint: null,
    sources: [
      { app: 'ecoaudit', email: 'raj@ecoaudit.users.local' },
      { app: 'solarsense', email: 'raj@solarsense.users.local' },
    ],
  });
  assert.deepEqual(sourceIdentitiesForFieldLogin('raj@ecoaudit.users.local'), {
    fieldEmail: 'raj@installhub.users.local',
    sourceHint: 'ecoaudit',
    sources: [
      { app: 'ecoaudit', email: 'raj@ecoaudit.users.local' },
      { app: 'solarsense', email: 'raj@solarsense.users.local' },
    ],
  });
  assert.deepEqual(sourceIdentitiesForFieldLogin('Admin@Example.com'), {
    fieldEmail: 'admin@example.com',
    sourceHint: null,
    sources: [
      { app: 'ecoaudit', email: 'admin@example.com' },
      { app: 'solarsense', email: 'admin@example.com' },
    ],
  });
});

test('Field preserves exact legacy explicit emails without overriding a forced source', () => {
  assert.equal(
    explicitFieldEmailForLogin('raj'),
    'raj@installhub.users.local',
  );
  assert.equal(
    explicitFieldEmailForLogin('raj@ecoaudit.users.local'),
    'raj@ecoaudit.users.local',
  );
  assert.equal(
    explicitFieldEmailForLogin('raj@wattwatchers.users.local'),
    'raj@wattwatchers.users.local',
  );
  assert.equal(
    explicitFieldEmailForLogin('Admin@Example.com'),
    'admin@example.com',
  );
  assert.equal(
    explicitFieldEmailForLogin('Admin@Example.com', 'ecoaudit'),
    null,
  );
});

test('Field source identities match the shared registry namespace', () => {
  const ecoBridge = fieldBridgeIdentity({ app: 'ecoaudit', id: 'source-user-1' });
  assert.deepEqual(
    ecoBridge,
    fieldBridgeIdentity({ app: 'ecoaudit', id: 'source-user-1' }),
  );
  assert.notDeepEqual(
    ecoBridge,
    fieldBridgeIdentity({ app: 'solarsense', id: 'source-user-1' }),
  );
  assert.match(
    ecoBridge.email,
    /^unified-field-[a-f0-9]{32}@installhub\.users\.local$/,
  );
  assert.equal(ecoBridge.id, 'unified-field:ecoaudit:source-user-1');
});

test('a disabled explicit Fleet user remains denied even with the right password', async () => {
  let checkedHash = '';
  const valid = await verifyActiveLogin({
    isActive: false,
    passwordHash: 'disabled-user-hash',
  }, 'correct-password', async (_password, passwordHash) => {
    checkedHash = passwordHash;
    return true;
  });

  assert.equal(valid, false);
  assert.notEqual(checkedHash, 'disabled-user-hash');
});

test('an active explicit Fleet identity authenticates independently', async () => {
  const valid = await verifyActiveLogin({
    isActive: true,
    passwordHash: 'fleet-hash',
  }, 'correct-password', async (password, passwordHash) => (
    password === 'correct-password' && passwordHash === 'fleet-hash'
  ));
  assert.equal(valid, true);
});

test('source-admin entitlement wins when the same credentials match an explicit Fleet viewer', () => {
  const sourceAdmin = {
    app: 'ecoaudit' as const, id: 'eco-admin', email: 'raj@ecoaudit.users.local',
    passwordHash: 'shared-hash', fullName: 'Eco Admin', role: 'admin', isActive: true,
  };
  assert.equal(selectFleetLoginAuthority(true, sourceAdmin), 'source_admin');
  assert.equal(selectFleetLoginAuthority(true, null), 'explicit_fleet');
  assert.equal(selectFleetLoginAuthority(false, null), null);
});

test('an explicit Field identity retains authority over a source match', () => {
  const sourceUser = {
    app: 'ecoaudit' as const,
    id: 'eco-user',
    email: 'user@ecoaudit.users.local',
    passwordHash: 'source-hash',
    fullName: 'Eco User',
    role: 'admin',
    isActive: true,
  };
  assert.equal(selectFieldLoginAuthority(true, sourceUser), 'explicit_field');
  assert.equal(selectFieldLoginAuthority(false, sourceUser), 'source_user');
  assert.equal(selectFieldLoginAuthority(false, null), null);
});

test('only an active source administrator with the matching password is eligible', async () => {
  const checkedHashes: string[] = [];
  const matched = await verifyFleetSourceAdmin([
    {
      app: 'ecoaudit', id: 'eco-admin', email: 'raj@ecoaudit.users.local',
      passwordHash: 'eco-admin-hash', fullName: 'Eco Admin', role: 'admin', isActive: true,
    },
    {
      app: 'solarsense', id: 'solar-inspector', email: 'raj@solarsense.users.local',
      passwordHash: 'solar-inspector-hash', fullName: 'Solar Inspector', role: 'inspector', isActive: true,
    },
  ], 'eco-password', async (password, passwordHash) => {
    checkedHashes.push(passwordHash);
    return password === 'eco-password' && passwordHash === 'eco-admin-hash';
  });

  assert.equal(matched?.id, 'eco-admin');
  assert.equal(checkedHashes.length, 2);
  assert.ok(checkedHashes.includes('eco-admin-hash'));
  assert.ok(!checkedHashes.includes('solar-inspector-hash'));
});

test('a matching SolarSense administrator is accepted when EcoAudit credentials do not match', async () => {
  const matched = await verifyFleetSourceAdmin([
    {
      app: 'ecoaudit', id: 'eco-admin', email: 'admin@example.com',
      passwordHash: 'eco-hash', fullName: 'Eco Admin', role: 'admin', isActive: true,
    },
    {
      app: 'solarsense', id: 'solar-admin', email: 'admin@example.com',
      passwordHash: 'solar-hash', fullName: 'Solar Admin', role: 'admin', isActive: true,
    },
  ], 'solar-password', async (password, passwordHash) => (
    password === 'solar-password' && passwordHash === 'solar-hash'
  ));

  assert.equal(matched?.app, 'solarsense');
  assert.equal(matched?.id, 'solar-admin');
});

test('inactive administrators and active non-admins cannot bridge into Fleet', async () => {
  const checkedHashes: string[] = [];
  const matched = await verifyFleetSourceAdmin([
    {
      app: 'ecoaudit', id: 'inactive-admin', email: 'inactive@example.com',
      passwordHash: 'inactive-admin-hash', fullName: null, role: 'admin', isActive: false,
    },
    {
      app: 'solarsense', id: 'active-inspector', email: 'inspector@example.com',
      passwordHash: 'active-inspector-hash', fullName: null, role: 'inspector', isActive: true,
    },
  ], 'correct-password', async (_password, passwordHash) => {
    checkedHashes.push(passwordHash);
    return true;
  });

  assert.equal(matched, null);
  assert.equal(checkedHashes.length, 2);
  assert.ok(!checkedHashes.includes('inactive-admin-hash'));
  assert.ok(!checkedHashes.includes('active-inspector-hash'));
});

test('Field accepts active inspectors and preserves their source membership', async () => {
  const matched = await verifyFieldSourceUser([
    {
      app: 'ecoaudit',
      id: 'eco-inspector',
      email: 'user@ecoaudit.users.local',
      passwordHash: 'eco-hash',
      fullName: 'Eco Inspector',
      role: 'inspector',
      isActive: true,
    },
    null,
  ], 'correct', async (password, hash) => (
    password === 'correct' && hash === 'eco-hash'
  ));

  assert.equal(matched?.id, 'eco-inspector');
  assert.equal(matched?.role, 'inspector');
});

test('Field rejects an ambiguous credential across independent source identities', async () => {
  const matched = await verifyFieldSourceUser([
    {
      app: 'ecoaudit',
      id: 'eco-admin',
      identityId: 'legacy:ecoaudit:eco-admin',
      email: 'shared@ecoaudit.users.local',
      passwordHash: 'shared-hash',
      fullName: 'Eco Admin',
      role: 'admin',
      isActive: true,
    },
    {
      app: 'solarsense',
      id: 'solar-inspector',
      identityId: 'legacy:solarsense:solar-inspector',
      email: 'shared@solarsense.users.local',
      passwordHash: 'shared-hash',
      fullName: 'Solar Inspector',
      role: 'inspector',
      isActive: true,
    },
  ], 'shared-password', async (_password, hash) => hash === 'shared-hash');

  assert.equal(matched, null);
});

test('an app-local Field login hint selects the exact source account', async () => {
  const matched = await verifyFieldSourceUser([
    {
      app: 'ecoaudit',
      id: 'eco-admin',
      email: 'shared@ecoaudit.users.local',
      passwordHash: 'shared-hash',
      fullName: 'Eco Admin',
      role: 'admin',
      isActive: true,
    },
    {
      app: 'solarsense',
      id: 'solar-inspector',
      email: 'shared@solarsense.users.local',
      passwordHash: 'shared-hash',
      fullName: 'Solar Inspector',
      role: 'inspector',
      isActive: true,
    },
  ], 'shared-password', async (_password, hash) => hash === 'shared-hash', 'ecoaudit');

  assert.equal(matched?.id, 'eco-admin');
  assert.equal(matched?.role, 'admin');
});

test('inactive Field source memberships never authenticate', async () => {
  const checkedHashes: string[] = [];
  const matched = await verifyFieldSourceUser([
    {
      app: 'ecoaudit',
      id: 'inactive-user',
      email: 'user@ecoaudit.users.local',
      passwordHash: 'inactive-hash',
      fullName: null,
      role: 'admin',
      isActive: false,
    },
    null,
  ], 'correct', async (_password, hash) => {
    checkedHashes.push(hash);
    return true;
  });

  assert.equal(matched, null);
  assert.ok(!checkedHashes.includes('inactive-hash'));
});
