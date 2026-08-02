import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;
const compatibilityMode = process.env.INSTALLHUB_UPLOAD_REVISION_CAS_REQUIRED === 'false';

test('legacy upload lifecycle remains additive during the explicit compatibility window', {
  skip: !integrationDatabase || !compatibilityMode,
}, async () => {
  const [
    { buildApp },
    { db, closeDb },
    { ihInstallations },
    { photoRegistry },
    { eq },
    { signAccessToken },
    { purgeInstallHubInstallationTree },
  ] = await Promise.all([
    import('../../app.js'),
    import('../../db/client.js'),
    import('../../db/schema/installhub.js'),
    import('../../db/schema/shared.js'),
    import('drizzle-orm'),
    import('../../auth/jwt.js'),
    import('./purge.js'),
  ]);
  const app = await buildApp();
  const installationId = randomUUID();
  const userId = randomUUID();
  const bytes = Buffer.from('legacy-compatible-evidence');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const token = signAccessToken({ userId, app: 'installhub', role: 'inspector' });
  try {
    await db.insert(ihInstallations).values({
      id: installationId,
      externalKey: `ih_compat_${installationId}`,
      siteCode: 'COMPAT',
      timezone: 'Australia/Sydney',
      treeSchemaVersion: 2,
      treeRevision: 1,
      recordVersionNumber: 0,
      clientName: 'Compatibility client',
      siteName: 'Compatibility site',
      siteAddress: '1 Compatibility Street',
      inspectorName: 'Compatibility Inspector',
      auditDate: '2026-08-02',
      status: 'Draft',
      createdByUserId: userId,
    });

    const identity = {
      installationId,
      entityType: 'installation',
      entityId: installationId,
      fieldName: 'photos[0]',
      checksum,
    };
    const firstCheck = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/check-photo',
      headers: { authorization: `Bearer ${token}` },
      payload: identity,
    });
    assert.equal(firstCheck.statusCode, 200, firstCheck.body);
    assert.equal(firstCheck.json().exists, false);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/create-upload-session',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...identity,
        filename: 'legacy.jpg',
        fileSizeBytes: bytes.length,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const createdBody = created.json() as { sessionId: string; uploadUrl: string };
    const signedUpload = new URL(createdBody.uploadUrl);
    const uploaded = await app.inject({
      method: 'PUT',
      url: `${signedUpload.pathname}${signedUpload.search}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: bytes,
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);

    const confirm = () => app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/confirm-upload',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: createdBody.sessionId, checksum },
    });
    const confirmed = await confirm();
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().treeRevision, 2);
    const replayed = await confirm();
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.deepEqual(replayed.json(), confirmed.json());

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/check-photo',
      headers: { authorization: `Bearer ${token}` },
      payload: identity,
    });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal(duplicate.json().exists, true);
    assert.equal(duplicate.json().treeRevision, 2);
    const [stored] = await db.select({
      baseTreeRevision: photoRegistry.baseTreeRevision,
      confirmedTreeRevision: photoRegistry.confirmedTreeRevision,
    }).from(photoRegistry).where(eq(photoRegistry.id, createdBody.sessionId));
    assert.deepEqual(stored, { baseTreeRevision: 1, confirmedTreeRevision: 2 });
  } finally {
    await purgeInstallHubInstallationTree(installationId).catch(() => {});
    await app.close();
    await closeDb();
  }
});
