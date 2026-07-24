import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { eaSyncRoutes } from '../routes/ecoaudit/sync.js';
import { installhubSyncRoutes } from '../routes/installhub/sync.js';
import { solarsenseSyncRoutes } from '../routes/solarsense/sync.js';
import {
  createConfiguredUploadUrl,
  requireUploadCapability,
} from './uploadCapability.js';

const sessionId = '11111111-2222-4333-8444-555555555555';

test('the request guard accepts a configured signed URL', async (t) => {
  const app = Fastify();
  app.put('/upload/:sessionId', {
    onRequest: requireUploadCapability('ecoaudit'),
  }, async () => ({ ok: true }));
  t.after(async () => app.close());

  const signedUrl = new URL(createConfiguredUploadUrl(
    `https://api.example.test/upload/${sessionId}`,
    'ecoaudit',
    sessionId,
  ));
  const response = await app.inject({
    method: 'PUT',
    url: `${signedUrl.pathname}${signedUrl.search}`,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
});

test('every raw upload route rejects a missing capability before session lookup', async (t) => {
  const app = Fastify();
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
  await app.register(eaSyncRoutes, { prefix: '/v1/ecoaudit/sync' });
  await app.register(solarsenseSyncRoutes, { prefix: '/v1/solarsense/sync' });
  await app.register(installhubSyncRoutes, { prefix: '/v1/installhub/sync' });
  t.after(async () => app.close());

  for (const product of ['ecoaudit', 'solarsense', 'installhub']) {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/${product}/sync/upload/${sessionId}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('raw upload bytes'),
    });

    assert.equal(response.statusCode, 401, product);
  }
});
