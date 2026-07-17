import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudEmailForLogin, verifyActiveLogin } from './loginIdentity.js';

test('Wattwatchers usernames resolve only to their explicit app identity', () => {
  assert.equal(cloudEmailForLogin('wattwatchers', ' Raj '), 'raj@wattwatchers.users.local');
  assert.equal(cloudEmailForLogin('wattwatchers', 'Admin@Example.com'), 'admin@example.com');
});

test('an Eco or Solar admin without an explicit Wattwatchers user cannot log in', async () => {
  assert.equal(await verifyActiveLogin(null, 'source-admin-password', async () => true), false);
});

test('a disabled Wattwatchers user remains denied even with the right password', async () => {
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

test('an active explicitly granted Wattwatchers identity can authenticate', async () => {
  const valid = await verifyActiveLogin({
    isActive: true,
    passwordHash: 'fleet-hash',
  }, 'correct-password', async (password, passwordHash) => (
    password === 'correct-password' && passwordHash === 'fleet-hash'
  ));
  assert.equal(valid, true);
});
