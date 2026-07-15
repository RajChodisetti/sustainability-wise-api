import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from './route';

test('rejects valid JSON values that are not request objects', async () => {
  const originalEnabled = process.env.PORTAL_REGISTRATION_ENABLED;
  const originalSecret = process.env.REGISTRATION_SECRET;
  process.env.PORTAL_REGISTRATION_ENABLED = 'true';
  process.env.REGISTRATION_SECRET = 'test-secret';

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
    if (originalSecret === undefined) delete process.env.REGISTRATION_SECRET;
    else process.env.REGISTRATION_SECRET = originalSecret;
  }
});
