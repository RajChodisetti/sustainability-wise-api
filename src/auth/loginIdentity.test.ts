import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudEmailForLogin,
  fleetBridgeIdentity,
  selectFleetLoginAuthority,
  sourceIdentitiesForFleetLogin,
  verifyActiveLogin,
  verifyFleetSourceAdmin,
} from './loginIdentity.js';

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
