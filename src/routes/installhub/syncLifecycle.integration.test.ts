import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('purge serializes ahead of v1/v2 sync and every upload lifecycle stage', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { buildApp },
    { db, closeDb },
    { ihInstallations },
    { photoRegistry, storageDeletionTasks },
    { and, eq },
    { signAccessToken },
    { createConfiguredUploadUrl },
    { localFileExists, writeLocalFile },
    { purgeInstallHubInstallationTree },
  ] = await Promise.all([
    import('../../app.js'),
    import('../../db/client.js'),
    import('../../db/schema/installhub.js'),
    import('../../db/schema/shared.js'),
    import('drizzle-orm'),
    import('../../auth/jwt.js'),
    import('../../auth/uploadCapability.js'),
    import('../../storage/localFiles.js'),
    import('./purge.js'),
  ]);
  const app = await buildApp();
  const userId = randomUUID();
  const token = signAccessToken({ userId, app: 'installhub', role: 'inspector' });

  const insertInstallation = async (treeSchemaVersion: 1 | 2) => {
    const id = randomUUID();
    const externalKey = `ih_race_${id}`;
    await db.insert(ihInstallations).values({
      id,
      externalKey,
      siteCode: 'RACE',
      timezone: 'Australia/Sydney',
      treeSchemaVersion,
      treeRevision: 1,
      recordVersionNumber: 0,
      clientName: 'Race client',
      siteName: 'Race site',
      siteAddress: '1 Race Street',
      inspectorName: 'Race Inspector',
      auditDate: '2026-08-01',
      status: 'Draft',
      createdByUserId: userId,
    });
    return { id, externalKey };
  };

  const racePurgeFirst = async <T>(installationId: string, action: () => Promise<T>) => {
    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.select({ id: ihInstallations.id }).from(ihInstallations)
        .where(eq(ihInstallations.id, installationId))
        .for('update');
      signalLocked();
      await release;
    });
    await locked;
    const purge = purgeInstallHubInstallationTree(installationId);
    await delay(25);
    const actionResult = action();
    await delay(25);
    releaseLock();
    await blocker;
    const [purgeOutcome, actionOutcome] = await Promise.allSettled([purge, actionResult]);
    if (purgeOutcome.status === 'rejected') throw purgeOutcome.reason;
    if (actionOutcome.status === 'rejected') throw actionOutcome.reason;
    return actionOutcome.value;
  };

  const assertPurged = async (installationId: string) => {
    const [installation] = await db.select({ id: ihInstallations.id })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, installationId));
    assert.equal(installation, undefined);
  };

  try {
    for (const treeSchemaVersion of [2, 1] as const) {
      const installation = await insertInstallation(treeSchemaVersion);
      const payload = treeSchemaVersion === 2
        ? {
            syncStage: 'metadata',
            treeSchemaVersion: 2,
            baseTreeRevision: 1,
            installation: {
              id: installation.id,
              externalKey: installation.externalKey,
              siteCode: 'RACE',
              timezone: 'Australia/Sydney',
              clientName: 'Race client',
              siteName: 'Race site',
              siteAddress: '1 Race Street',
              inspectorName: 'Race Inspector',
              auditDate: '2026-08-01',
              status: 'Draft',
              treeSchemaVersion: 2,
              treeRevision: 1,
              recordVersionNumber: 0,
            },
            gridSupplies: [{
              id: `${installation.id}-grid`,
              installationId: installation.id,
              name: 'Grid',
              isDefault: true,
            }],
            zones: [],
            electricalAssets: [],
            siteAssets: [],
            meterDevices: [],
            measurementAssignments: [],
            formSubmissions: [],
          }
        : {
            syncStage: 'metadata',
            installation: {
              id: installation.id,
              clientName: 'Race client',
              siteName: 'Race site',
              siteAddress: '1 Race Street',
              inspectorName: 'Race Inspector',
              auditDate: '2026-08-01',
              status: 'Draft',
            },
            zones: [],
            electricalAssets: [],
            siteAssets: [],
            formSubmissions: [],
          };
      const response = await racePurgeFirst(installation.id, () => app.inject({
        method: 'POST',
        url: '/v1/installhub/sync/push',
        headers: { authorization: `Bearer ${token}` },
        payload,
      }));
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().detail, 'installation_purged');
      await assertPurged(installation.id);
    }

    const createInstallation = await insertInstallation(2);
    const createBody = Buffer.from('create-session-race');
    const createResponse = await racePurgeFirst(createInstallation.id, () => app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/create-upload-session',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        checksum: createHash('sha256').update(createBody).digest('hex'),
        installationId: createInstallation.id,
        baseTreeRevision: 1,
        entityType: 'installation',
        entityId: createInstallation.id,
        fieldName: 'photos[0]',
        filename: 'create.jpg',
        fileSizeBytes: createBody.length,
      },
    }));
    assert.equal(createResponse.statusCode, 404, createResponse.body);
    await assertPurged(createInstallation.id);
    const [orphanCreateSession] = await db.select({ id: photoRegistry.id })
      .from(photoRegistry)
      .where(eq(photoRegistry.parentId, createInstallation.id));
    assert.equal(orphanCreateSession, undefined);

    const uploadInstallation = await insertInstallation(2);
    const uploadSessionId = randomUUID();
    const uploadBody = Buffer.from('raw-upload-race');
    const uploadStorageKey = `installhub/race/${uploadInstallation.id}/${uploadSessionId}.jpg`;
    await db.insert(photoRegistry).values({
      id: uploadSessionId,
      checksum: createHash('sha256').update(uploadBody).digest('hex'),
      storageKey: uploadStorageKey,
      originalFilename: 'upload.jpg',
      app: 'installhub',
      parentId: uploadInstallation.id,
      entityType: 'installation',
      entityId: uploadInstallation.id,
      fieldName: 'photos[0]',
      fileSizeBytes: uploadBody.length,
      status: 'pending',
    });
    const absoluteUploadUrl = createConfiguredUploadUrl(
      `http://localhost/v1/installhub/sync/upload/${uploadSessionId}`,
      'installhub',
      uploadSessionId,
    );
    const uploadUrl = new URL(absoluteUploadUrl);
    const uploadResponse = await racePurgeFirst(uploadInstallation.id, () => app.inject({
      method: 'PUT',
      url: `${uploadUrl.pathname}${uploadUrl.search}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: uploadBody,
    }));
    assert.equal(uploadResponse.statusCode, 404, uploadResponse.body);
    await assertPurged(uploadInstallation.id);
    assert.equal(await localFileExists(uploadStorageKey), false);

    const confirmInstallation = await insertInstallation(2);
    const confirmSessionId = randomUUID();
    const confirmBody = Buffer.from('confirm-upload-race');
    const confirmStorageKey = `installhub/race/${confirmInstallation.id}/${confirmSessionId}.jpg`;
    const confirmedWrite = await writeLocalFile(confirmStorageKey, confirmBody);
    await db.insert(photoRegistry).values({
      id: confirmSessionId,
      checksum: confirmedWrite.checksum,
      storageKey: confirmStorageKey,
      originalFilename: 'confirm.jpg',
      app: 'installhub',
      parentId: confirmInstallation.id,
      entityType: 'installation',
      entityId: confirmInstallation.id,
      fieldName: 'photos[0]',
      fileSizeBytes: confirmBody.length,
      contentType: 'image/jpeg',
      status: 'uploaded',
      uploadedAt: new Date(),
    });
    const confirmResponse = await racePurgeFirst(confirmInstallation.id, () => app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/confirm-upload',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: confirmSessionId, checksum: confirmedWrite.checksum },
    }));
    assert.equal(confirmResponse.statusCode, 404, confirmResponse.body);
    await assertPurged(confirmInstallation.id);
    assert.equal(await localFileExists(confirmStorageKey), false);

    for (const [sessionId, storageKey] of [
      [uploadSessionId, uploadStorageKey],
      [confirmSessionId, confirmStorageKey],
    ] as const) {
      const [registry] = await db.select({ id: photoRegistry.id })
        .from(photoRegistry)
        .where(eq(photoRegistry.id, sessionId));
      const [pendingCleanup] = await db.select({ id: storageDeletionTasks.id })
        .from(storageDeletionTasks)
        .where(and(
          eq(storageDeletionTasks.app, 'installhub'),
          eq(storageDeletionTasks.storageKey, storageKey),
        ));
      assert.equal(registry, undefined);
      assert.equal(pendingCleanup, undefined);
    }
  } finally {
    await app.close();
    await closeDb();
  }
});
