import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudEmailForLogin,
  explicitFieldEmailForLogin,
  fieldBridgeIdentity,
  selectFieldLoginAuthority,
  sourceIdentitiesForFieldLogin,
  verifyFieldSourceUser,
  type FieldSourceUser,
} from './loginIdentity.js';

const ecoUser: FieldSourceUser = {
  app: 'ecoaudit',
  id: 'eco-user',
  identityId: 'legacy:ecoaudit:eco-user',
  email: 'shared@ecoaudit.users.local',
  passwordHash: 'shared-hash',
  fullName: 'Eco Administrator',
  role: 'admin',
  isActive: true,
};

const solarUser: FieldSourceUser = {
  app: 'solarsense',
  id: 'solar-user',
  identityId: 'legacy:solarsense:solar-user',
  email: 'shared@solarsense.users.local',
  passwordHash: 'shared-hash',
  fullName: 'Solar Inspector',
  role: 'inspector',
  isActive: true,
};

test('legacy app-local usernames and response namespaces remain unchanged', () => {
  assert.equal(
    cloudEmailForLogin('ecoaudit', ' Legacy.User '),
    'legacy.user@ecoaudit.users.local',
  );
  assert.equal(
    cloudEmailForLogin('solarsense', ' Legacy.User '),
    'legacy.user@solarsense.users.local',
  );
  assert.equal(
    cloudEmailForLogin('installhub', ' Legacy.User '),
    'legacy.user@installhub.users.local',
  );
  assert.equal(
    cloudEmailForLogin('wattwatchers', ' Legacy.User '),
    'legacy.user@wattwatchers.users.local',
  );
});

test('explicit Field rows retain exact historical source-local email addresses', () => {
  for (const email of [
    'legacy@ecoaudit.users.local',
    'legacy@solarsense.users.local',
    'legacy@installhub.users.local',
    'legacy@wattwatchers.users.local',
    'legacy@example.com',
  ]) {
    assert.equal(explicitFieldEmailForLogin(` ${email.toUpperCase()} `), email);
  }
  assert.equal(selectFieldLoginAuthority(true, ecoUser), 'explicit_field');
});

for (const sourceUser of [ecoUser, solarUser]) {
  test(`targeted ${sourceUser.app} Field authentication preserves role and provenance`, async () => {
    const resolved = sourceIdentitiesForFieldLogin(sourceUser.email);
    const matched = await verifyFieldSourceUser(
      [ecoUser, solarUser],
      'correct-password',
      async (_password, hash) => hash === sourceUser.passwordHash,
      sourceUser.app,
    );

    assert.equal(resolved.sourceHint, sourceUser.app);
    assert.deepEqual(matched, sourceUser);
    assert.equal(matched?.role, sourceUser.role);
    assert.equal(matched?.app, sourceUser.app);
    assert.match(
      fieldBridgeIdentity(sourceUser).email,
      /^unified-field-[a-f0-9]{32}@installhub\.users\.local$/,
    );
  });
}

test('unhinted matching credentials never merge independent Eco and Solar users', async () => {
  const matched = await verifyFieldSourceUser(
    [ecoUser, solarUser],
    'correct-password',
    async (_password, hash) => hash === 'shared-hash',
  );

  assert.equal(matched, null);
  assert.notEqual(
    fieldBridgeIdentity(ecoUser).id,
    fieldBridgeIdentity(solarUser).id,
  );
});
