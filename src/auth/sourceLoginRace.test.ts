import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(
  new URL('../routes/auth.ts', import.meta.url),
  'utf8',
);

test('source login revalidates under a row lock before inserting refresh tokens', () => {
  const helperStart = authSource.indexOf(
    'async function issueSourceTokensAfterVerifiedPassword',
  );
  const helperEnd = authSource.indexOf(
    'async function issueFieldTokensForSource',
    helperStart,
  );
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  const helper = authSource.slice(helperStart, helperEnd);
  assert.match(helper, /db\.transaction\(async \(tx\) =>/);
  assert.match(helper, /\.for\('update'\)/);
  assert.match(
    helper,
    /sourceUser\.passwordHash !== verified\.passwordHash/,
  );
  assert.match(helper, /!sourceUser\?\.isActive/);
  assert.match(
    helper,
    /await tx\.insert\(refreshTokens\)\.values\(issued\.refreshTokenRecord\)/,
  );
});

test('legacy Eco and Solar login uses the locked source-session issuer', () => {
  const sourceLoginBranch = authSource.slice(
    authSource.indexOf(
      "if (requestedApp === 'ecoaudit' || requestedApp === 'solarsense')",
    ),
    authSource.indexOf("if (requestedApp === 'installhub')"),
  );
  assert.match(
    sourceLoginBranch,
    /return issueSourceTokensAfterVerifiedPassword\(/,
  );
  assert.doesNotMatch(sourceLoginBranch, /return issueTokens\(/);
});
