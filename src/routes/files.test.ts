import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { createConfiguredFileUrl } from '../auth/fileCapability.js';
import {
  deleteLocalFile,
  publicFileUrl,
  writeLocalFile,
} from '../storage/localFiles.js';
import { fileRoutes } from './files.js';

test('stored file route rejects public-by-URL access and accepts a signed capability', async () => {
  const storageKey = `ecoaudit/file-route-test/audit/report-${randomUUID()}.pdf`;
  const body = Buffer.from('private report bytes');
  await writeLocalFile(storageKey, body);
  const app = Fastify();
  await app.register(fileRoutes);
  try {
    const unsigned = await app.inject({
      method: 'GET',
      url: new URL(publicFileUrl(storageKey)).pathname,
    });
    assert.equal(unsigned.statusCode, 401);
    const unsignedHead = await app.inject({
      method: 'HEAD',
      url: new URL(publicFileUrl(storageKey)).pathname,
    });
    assert.equal(unsignedHead.statusCode, 401);

    const signedUrl = createConfiguredFileUrl(publicFileUrl(storageKey), storageKey);
    const signed = await app.inject({
      method: 'GET',
      url: `${new URL(signedUrl).pathname}${new URL(signedUrl).search}`,
    });
    assert.equal(signed.statusCode, 200);
    assert.deepEqual(signed.rawPayload, body);
    const signedHead = await app.inject({
      method: 'HEAD',
      url: `${new URL(signedUrl).pathname}${new URL(signedUrl).search}`,
    });
    assert.equal(signedHead.statusCode, 200);
    assert.equal(signedHead.headers['content-length'], String(body.length));

    const tampered = new URL(signedUrl);
    tampered.searchParams.set('signature', '0'.repeat(64));
    const rejected = await app.inject({
      method: 'GET',
      url: `${tampered.pathname}${tampered.search}`,
    });
    assert.equal(rejected.statusCode, 401);
  } finally {
    await app.close();
    await deleteLocalFile(storageKey);
  }
});
