import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(
  new URL('../routes/auth.ts', import.meta.url),
  'utf8',
);

test('global product login revalidates membership and credential under locks', () => {
  const helperStart = authSource.indexOf(
    'async function issueGlobalTokensAfterVerifiedPassword',
  );
  const helperEnd = authSource.indexOf(
    'async function loginForGlobalProduct',
    helperStart,
  );
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  const helper = authSource.slice(helperStart, helperEnd);
  assert.match(helper, /db\.transaction\(async \(tx\) =>/);
  assert.match(helper, /membershipSnapshot\.originUserId\)\)\.for\('update'\)/);
  assert.match(helper, /globalUsers\.id, verified\.globalUserId/);
  assert.match(helper, /globalUserCredentials\.passwordHash, verified\.passwordHash/);
  assert.match(helper, /!globalUser\?\.isActive/);
  assert.match(helper, /!productUser\?\.isActive/);
  assert.match(
    helper,
    /await tx\.insert\(refreshTokens\)\.values\(issued\.refreshTokenRecord\)/,
  );
});

test('all three released products use the locked canonical issuer', () => {
  const loginBranch = authSource.slice(
    authSource.indexOf('async function loginForApp'),
    authSource.indexOf('const { fleetEmail, sources }'),
  );
  assert.match(loginBranch, /requestedApp === 'ecoaudit'/);
  assert.match(loginBranch, /requestedApp === 'solarsense'/);
  assert.match(loginBranch, /requestedApp === 'installhub'/);
  assert.match(
    loginBranch,
    /return loginForGlobalProduct\(email, password, requestedApp\)/,
  );
  assert.doesNotMatch(loginBranch, /return issueTokens\(/);
});
