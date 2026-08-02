import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('first upload confirmation increments revision once and replay is idempotent', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { buildApp },
    { db, closeDb },
    { ihInstallations, ihZones },
    { photoRegistry },
    { signAccessToken },
    { makePhotoStorageKeyFromNames },
    { writeLocalFile },
    { eq },
    { purgeInstallHubInstallationTree },
  ] = await Promise.all([
    import('../../app.js'),
    import('../../db/client.js'),
    import('../../db/schema/installhub.js'),
    import('../../db/schema/shared.js'),
    import('../../auth/jwt.js'),
    import('../../services/storageNaming.js'),
    import('../../storage/localFiles.js'),
    import('drizzle-orm'),
    import('./purge.js'),
  ]);
  const app = await buildApp();
  const installationId = randomUUID();
  const zoneId = randomUUID();
  const sessionId = randomUUID();
  const userId = randomUUID();
  try {
    await db.insert(ihInstallations).values({
      id: installationId,
      externalKey: `ih_test_${installationId}`,
      siteCode: 'TEST',
      timezone: 'Australia/Sydney',
      treeSchemaVersion: 2,
      treeRevision: 4,
      recordVersionNumber: 0,
      clientName: 'Confirm test',
      siteName: 'Confirm test',
      siteAddress: '1 Test Street',
      inspectorName: 'Test Inspector',
      auditDate: '2026-08-01',
      status: 'Draft',
      createdByUserId: userId,
    });
    await db.insert(ihZones).values({
      id: zoneId,
      installationId,
      zoneName: 'Plant room',
    });
    const storageKey = makePhotoStorageKeyFromNames({
      app: 'installhub',
      parentName: 'Confirm test',
      entityType: 'zone',
      entityName: 'Plant room',
      fieldName: 'photos[0]',
      sessionId,
      filename: 'evidence.jpg',
    });
    const body = Buffer.from('rehearsal photo bytes');
    const written = await writeLocalFile(storageKey, body);
    await db.insert(photoRegistry).values({
      id: sessionId,
      checksum: written.checksum,
      storageKey,
      contentType: 'image/jpeg',
      originalFilename: 'evidence.jpg',
      app: 'installhub',
      parentId: installationId,
      entityType: 'zone',
      entityId: zoneId,
      fieldName: 'photos[0]',
      fileSizeBytes: written.size,
      status: 'uploaded',
      uploadedAt: new Date(),
    });
    const token = signAccessToken({ userId, app: 'installhub', role: 'inspector' });
    const invalidCanonicalPush = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        syncStage: 'metadata',
        treeSchemaVersion: 2,
        baseTreeRevision: 4,
        installation: {
          id: installationId,
          externalKey: `ih_test_${installationId}`,
          siteCode: 'TEST',
          timezone: 'Australia/Sydney',
          treeSchemaVersion: 2,
          treeRevision: 4,
          recordVersionNumber: 0,
          clientName: 'Confirm test',
          siteName: 'Confirm test',
          siteAddress: '1 Test Street',
          inspectorName: 'Test Inspector',
          auditDate: '2026-08-01',
          status: 'Draft',
        },
        gridSupplies: [],
        zones: [],
        electricalAssets: [],
        siteAssets: [],
        meterDevices: [],
        measurementAssignments: [],
        formSubmissions: [],
      },
    });
    assert.equal(invalidCanonicalPush.statusCode, 400, invalidCanonicalPush.body);
    assert.match(invalidCanonicalPush.json().detail, /Exactly one active Grid supply/);
    const [unchangedAfterRejectedPush] = await db
      .select({ treeRevision: ihInstallations.treeRevision })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, installationId));
    assert.equal(unchangedAfterRejectedPush.treeRevision, 4);

    const confirm = () => app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/confirm-upload',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, checksum: written.checksum },
    });
    const first = await confirm();
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json(), {
      remoteUrl: first.json().remoteUrl,
      treeRevision: 5,
    });
    assert.match(first.json().remoteUrl, /^http:\/\//);
    const replay = await confirm();
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), first.json());
    const [installation] = await db
      .select({
        treeRevision: ihInstallations.treeRevision,
        recordVersionNumber: ihInstallations.recordVersionNumber,
      })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, installationId));
    assert.deepEqual(installation, { treeRevision: 5, recordVersionNumber: 0 });
  } finally {
    await db.update(ihInstallations).set({ status: 'Draft' })
      .where(eq(ihInstallations.id, installationId));
    await purgeInstallHubInstallationTree(installationId).catch(() => {});
    await app.close();
    await closeDb();
  }
});
