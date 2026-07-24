import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from './route';

test('rejects valid JSON values that are not request objects', async () => {
  const originalEnabled = process.env.PORTAL_REGISTRATION_ENABLED;
  const originalEcoSecret = process.env.ECOAUDIT_REGISTRATION_SECRET;
  const originalSolarSecret = process.env.SOLARSENSE_REGISTRATION_SECRET;
  process.env.PORTAL_REGISTRATION_ENABLED = 'true';
  process.env.ECOAUDIT_REGISTRATION_SECRET = 'test-eco-secret';
  process.env.SOLARSENSE_REGISTRATION_SECRET = 'test-solar-secret';

  try {
    for (const body of [null, [], true, 42, 'text']) {
      const response = await POST(new Request('http://portal.test/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Invalid JSON request.' });
    }
  } finally {
    if (originalEnabled === undefined) delete process.env.PORTAL_REGISTRATION_ENABLED;
    else process.env.PORTAL_REGISTRATION_ENABLED = originalEnabled;
    if (originalEcoSecret === undefined) delete process.env.ECOAUDIT_REGISTRATION_SECRET;
    else process.env.ECOAUDIT_REGISTRATION_SECRET = originalEcoSecret;
    if (originalSolarSecret === undefined) delete process.env.SOLARSENSE_REGISTRATION_SECRET;
    else process.env.SOLARSENSE_REGISTRATION_SECRET = originalSolarSecret;
  }
});
