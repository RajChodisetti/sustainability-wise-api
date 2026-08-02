import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('fresh canonical push round-trips identity/CAS and upload confirmation replays safely', {
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
  const legacyPhotoId = randomUUID();
  const racedSessionId = randomUUID();
  const userId = randomUUID();
  const freshInstallationId = randomUUID();
  const derivedSiteCodeInstallationId = randomUUID();
  const invalidSiteCodeInstallationId = randomUUID();
  const importedCopyId = randomUUID();
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
      baseTreeRevision: 4,
      uploadedAt: new Date(),
    });
    await db.insert(photoRegistry).values({
      id: legacyPhotoId,
      checksum: written.checksum,
      storageKey,
      contentType: 'image/jpeg',
      originalFilename: 'legacy-evidence.jpg',
      app: 'installhub',
      parentId: installationId,
      entityType: 'zone',
      entityId: zoneId,
      fieldName: 'photos[0]',
      fileSizeBytes: written.size,
      status: 'confirmed',
      remoteUrl: 'https://legacy.example.test/evidence.jpg',
      baseTreeRevision: null,
      confirmedTreeRevision: null,
      uploadedAt: new Date(),
    });
    const token = signAccessToken({ userId, app: 'installhub', role: 'inspector' });
    const freshPayload = (
      id: string,
      externalKey = `local:${id}`,
      baseTreeRevision: number | null = 0,
    ) => ({
      syncStage: 'metadata',
      treeSchemaVersion: 2,
      ...(baseTreeRevision === null ? {} : { baseTreeRevision }),
      installation: {
        id,
        treeSchemaVersion: 2,
        externalKey,
        siteCode: 'ROUTE',
        timezone: 'Australia/Sydney',
        treeRevision: 0,
        recordVersionNumber: 0,
        clientName: 'Route Client',
        siteName: 'Route Site',
        siteAddress: '1 Route Street',
        inspectorName: 'Route Inspector',
        auditDate: '2026-08-02',
        status: 'Draft',
      },
      gridSupplies: [{
        id: `grid_${id}_primary`,
        installationId: id,
        name: 'Grid supply',
        isDefault: true,
      }],
      zones: [],
      electricalAssets: [],
      siteAssets: [],
      meterDevices: [],
      measurementAssignments: [],
      formSubmissions: [],
      serverDerived: { virtualMeterDefinitions: [] },
    });
    const push = (payload: Record<string, unknown>) => app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const pull = (id: string) => app.inject({
      method: 'GET',
      url: `/v1/installhub/sync/pull?since=1970-01-01T00%3A00%3A00.000Z&installationId=${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const freshCreate = await push(freshPayload(freshInstallationId));
    assert.equal(freshCreate.statusCode, 200, freshCreate.body);
    assert.equal(freshCreate.json().treeRevision, 1);
    const freshReplay = await push(freshPayload(freshInstallationId));
    assert.equal(freshReplay.statusCode, 200, freshReplay.body);
    assert.equal(freshReplay.json().treeRevision, 1);

    const invalidFreshSiteCode = freshPayload(invalidSiteCodeInstallationId);
    invalidFreshSiteCode.installation.siteCode = 'Invalid Fresh Site Code';
    const invalidFreshSiteCodeResult = await push(invalidFreshSiteCode);
    assert.equal(invalidFreshSiteCodeResult.statusCode, 400, invalidFreshSiteCodeResult.body);
    assert.match(invalidFreshSiteCodeResult.json().detail, /installation\.siteCode must be 1-16/);
    const blankFreshSiteCode = freshPayload(invalidSiteCodeInstallationId);
    blankFreshSiteCode.installation.siteCode = '';
    const blankFreshSiteCodeResult = await push(blankFreshSiteCode);
    assert.equal(blankFreshSiteCodeResult.statusCode, 400, blankFreshSiteCodeResult.body);
    assert.match(blankFreshSiteCodeResult.json().detail, /installation\.siteCode is required/);

    const derivedFreshSiteCode = freshPayload(derivedSiteCodeInstallationId);
    delete (derivedFreshSiteCode.installation as { siteCode?: string }).siteCode;
    const derivedFreshSiteCodeResult = await push(derivedFreshSiteCode);
    assert.equal(derivedFreshSiteCodeResult.statusCode, 200, derivedFreshSiteCodeResult.body);
    const derivedFreshSiteCodePull = await pull(derivedSiteCodeInstallationId);
    assert.equal(
      derivedFreshSiteCodePull.json().installations[0].installation.siteCode,
      'RS',
    );
    const firstPull = await pull(freshInstallationId);
    assert.equal(firstPull.statusCode, 200, firstPull.body);
    const firstTree = firstPull.json().installations[0] as Record<string, unknown>;
    const firstInstallation = firstTree.installation as Record<string, unknown>;
    assert.match(String(firstInstallation.externalKey), /^ih_/);
    assert.doesNotMatch(String(firstInstallation.externalKey), /^local:/);
    assert.equal(firstInstallation.treeRevision, 1);

    const update = structuredClone(firstTree);
    update.syncStage = 'metadata';
    update.baseTreeRevision = 1;
    (update.installation as Record<string, unknown>).siteAddress = '2 Updated Route Street';
    const updated = await push(update);
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().treeRevision, 2);

    const stale = structuredClone(firstTree);
    stale.syncStage = 'metadata';
    stale.baseTreeRevision = 1;
    (stale.installation as Record<string, unknown>).siteAddress = '3 Stale Route Street';
    const staleResult = await push(stale);
    assert.equal(staleResult.statusCode, 409, staleResult.body);
    assert.match(staleResult.json().detail, /snapshot_conflict/);
    const afterStalePull = await pull(freshInstallationId);
    assert.equal(
      afterStalePull.json().installations[0].installation.siteAddress,
      '2 Updated Route Street',
    );
    const exactComplete = structuredClone(afterStalePull.json().installations[0]);
    exactComplete.syncStage = 'complete';
    exactComplete.baseTreeRevision = 2;
    const firstExactComplete = await push(exactComplete);
    assert.equal(firstExactComplete.statusCode, 200, firstExactComplete.body);
    assert.equal(firstExactComplete.json().treeRevision, 2);
    assert.equal(firstExactComplete.json().recordVersionNumber, 1);
    const replayExactComplete = await push(exactComplete);
    assert.equal(replayExactComplete.statusCode, 200, replayExactComplete.body);
    assert.equal(replayExactComplete.json().treeRevision, 2);
    assert.equal(replayExactComplete.json().recordVersionNumber, 1);

    const changedAfterPin = structuredClone(afterStalePull.json().installations[0]);
    changedAfterPin.syncStage = 'metadata';
    changedAfterPin.baseTreeRevision = 2;
    (changedAfterPin.installation as Record<string, unknown>).siteAddress =
      '4 Changed After Pin Street';
    const changedAfterPinResult = await push(changedAfterPin);
    assert.equal(changedAfterPinResult.statusCode, 200, changedAfterPinResult.body);
    assert.equal(changedAfterPinResult.json().treeRevision, 3);
    const changedAfterPinPull = await pull(freshInstallationId);
    const secondExactComplete = structuredClone(changedAfterPinPull.json().installations[0]);
    secondExactComplete.syncStage = 'complete';
    secondExactComplete.baseTreeRevision = 3;
    const secondPin = await push(secondExactComplete);
    assert.equal(secondPin.statusCode, 200, secondPin.body);
    assert.equal(secondPin.json().recordVersionNumber, 2);
    const completed = await app.inject({
      method: 'POST',
      url: `/v1/installhub/installations/${freshInstallationId}/complete`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        baseTreeRevision: 3,
        idempotencyKey: `complete-${freshInstallationId}`,
      },
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(completed.json().treeRevision, 4);
    assert.equal(completed.json().recordVersionNumber, 3);
    const completedPull = await pull(freshInstallationId);
    const completedExactTree = structuredClone(completedPull.json().installations[0]);
    completedExactTree.syncStage = 'complete';
    completedExactTree.baseTreeRevision = 4;
    const completedExactReplay = await push(completedExactTree);
    assert.equal(completedExactReplay.statusCode, 200, completedExactReplay.body);
    assert.equal(completedExactReplay.json().treeRevision, 4);
    assert.equal(completedExactReplay.json().recordVersionNumber, 3);
    const completedChangedReplay = structuredClone(completedExactTree);
    (completedChangedReplay.installation as Record<string, unknown>).siteAddress =
      'Completed mutation must fail';
    const completedChangedResult = await push(completedChangedReplay);
    assert.equal(completedChangedResult.statusCode, 409, completedChangedResult.body);
    assert.match(completedChangedResult.json().detail, /installation_completed_reopen_required/);
    const reopened = await app.inject({
      method: 'POST',
      url: `/v1/installhub/installations/${freshInstallationId}/reopen`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        baseTreeRevision: 4,
        reason: 'Continue historical site-code compatibility verification',
      },
    });
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.equal(reopened.json().treeRevision, 5);

    const importedPayload = freshPayload(
      importedCopyId,
      String(firstInstallation.externalKey),
      null,
    );
    const importedCreate = await push(importedPayload);
    assert.equal(importedCreate.statusCode, 200, importedCreate.body);
    assert.equal(importedCreate.json().treeRevision, 1);
    const importedReplay = await push(importedPayload);
    assert.equal(importedReplay.statusCode, 200, importedReplay.body);
    assert.equal(importedReplay.json().treeRevision, 1);
    const importedRevisionFirstCrashReplay = structuredClone(importedPayload);
    importedRevisionFirstCrashReplay.baseTreeRevision = 1;
    const importedRecovered = await push(importedRevisionFirstCrashReplay);
    assert.equal(importedRecovered.statusCode, 200, importedRecovered.body);
    assert.equal(importedRecovered.json().treeRevision, 1);
    const importedPull = await pull(importedCopyId);
    const importedExternalKey = importedPull.json().installations[0].installation.externalKey;
    assert.match(String(importedExternalKey), /^ih_/);
    assert.notEqual(importedExternalKey, firstInstallation.externalKey);

    const changedWithoutBase = structuredClone(importedPayload);
    (changedWithoutBase.installation as Record<string, unknown>).siteAddress = 'Changed without base';
    const changedWithoutBaseResult = await push(changedWithoutBase);
    assert.equal(changedWithoutBaseResult.statusCode, 409, changedWithoutBaseResult.body);
    assert.match(changedWithoutBaseResult.json().detail, /baseTreeRevision_required/);
    const importedAfterRejectedChange = await pull(importedCopyId);
    assert.equal(
      importedAfterRejectedChange.json().installations[0].installation.siteAddress,
      '1 Route Street',
    );

    const changedWithAcceptedBase = structuredClone(importedRevisionFirstCrashReplay);
    (changedWithAcceptedBase.installation as Record<string, unknown>).siteAddress =
      'Identity replacement must not mutate';
    const changedWithAcceptedBaseResult = await push(changedWithAcceptedBase);
    assert.equal(changedWithAcceptedBaseResult.statusCode, 409, changedWithAcceptedBaseResult.body);
    assert.match(changedWithAcceptedBaseResult.json().detail, /external_key_conflict/);

    // Canonical-v2 site codes were historically any non-empty string. Simulate
    // one of those persisted rows and prove it remains readable, editable and
    // snapshot-capable without allowing a different invalid code to be written.
    const historicalSiteCode = 'Legacy Site Code / 2024';
    await db.update(ihInstallations).set({ siteCode: historicalSiteCode })
      .where(eq(ihInstallations.id, freshInstallationId));
    const historicalPull = await pull(freshInstallationId);
    assert.equal(historicalPull.statusCode, 200, historicalPull.body);
    assert.equal(
      historicalPull.json().installations[0].installation.siteCode,
      historicalSiteCode,
    );
    const historicalEdit = structuredClone(historicalPull.json().installations[0]);
    historicalEdit.syncStage = 'metadata';
    historicalEdit.baseTreeRevision = 5;
    historicalEdit.installation.siteAddress = '5 Historical Code Street';
    const historicalEditResult = await push(historicalEdit);
    assert.equal(historicalEditResult.statusCode, 200, historicalEditResult.body);
    assert.equal(historicalEditResult.json().treeRevision, 6);

    const afterHistoricalEdit = await pull(freshInstallationId);
    const rejectedHistoricalRename = structuredClone(
      afterHistoricalEdit.json().installations[0],
    );
    rejectedHistoricalRename.syncStage = 'metadata';
    rejectedHistoricalRename.baseTreeRevision = 6;
    rejectedHistoricalRename.installation.siteCode = 'Different Legacy Code';
    const rejectedHistoricalRenameResult = await push(rejectedHistoricalRename);
    assert.equal(
      rejectedHistoricalRenameResult.statusCode,
      400,
      rejectedHistoricalRenameResult.body,
    );
    assert.match(rejectedHistoricalRenameResult.json().detail, /installation\.siteCode must be 1-16/);

    const acceptedCanonicalRename = structuredClone(
      afterHistoricalEdit.json().installations[0],
    );
    acceptedCanonicalRename.syncStage = 'metadata';
    acceptedCanonicalRename.baseTreeRevision = 6;
    acceptedCanonicalRename.installation.siteCode = 'LEGACY-2024';
    const acceptedCanonicalRenameResult = await push(acceptedCanonicalRename);
    assert.equal(
      acceptedCanonicalRenameResult.statusCode,
      200,
      acceptedCanonicalRenameResult.body,
    );
    assert.equal(acceptedCanonicalRenameResult.json().treeRevision, 7);

    const staleHistoricalCodeReplay = structuredClone(
      afterHistoricalEdit.json().installations[0],
    );
    staleHistoricalCodeReplay.syncStage = 'metadata';
    staleHistoricalCodeReplay.baseTreeRevision = 6;
    const staleHistoricalCodeResult = await push(staleHistoricalCodeReplay);
    assert.equal(staleHistoricalCodeResult.statusCode, 409, staleHistoricalCodeResult.body);
    assert.match(staleHistoricalCodeResult.json().detail, /snapshot_conflict/);

    // Snapshot generation also canonicalizes the server tree. Reinsert a
    // historical value without changing the revision to model an upgraded DB,
    // then prove an exact complete-stage replay can pin it immutably.
    await db.update(ihInstallations).set({ siteCode: historicalSiteCode })
      .where(eq(ihInstallations.id, freshInstallationId));
    const historicalSnapshotPull = await pull(freshInstallationId);
    const historicalSnapshot = structuredClone(
      historicalSnapshotPull.json().installations[0],
    );
    historicalSnapshot.syncStage = 'complete';
    historicalSnapshot.baseTreeRevision = 7;
    const historicalSnapshotResult = await push(historicalSnapshot);
    assert.equal(historicalSnapshotResult.statusCode, 200, historicalSnapshotResult.body);
    assert.equal(historicalSnapshotResult.json().treeRevision, 7);
    assert.ok(historicalSnapshotResult.json().recordVersionNumber >= 4);

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
    const missingBaseCheck = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/check-photo',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        installationId,
        entityType: 'zone',
        entityId: zoneId,
        fieldName: 'photos[0]',
        checksum: written.checksum,
      },
    });
    assert.equal(missingBaseCheck.statusCode, 409, missingBaseCheck.body);
    assert.match(missingBaseCheck.json().detail, /client_upgrade_required/);
    const missingBaseSession = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/create-upload-session',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        installationId,
        entityType: 'zone',
        entityId: zoneId,
        fieldName: 'photos[0]',
        checksum: written.checksum,
        filename: 'missing-base.jpg',
        fileSizeBytes: written.size,
      },
    });
    assert.equal(missingBaseSession.statusCode, 409, missingBaseSession.body);
    assert.match(missingBaseSession.json().detail, /client_upgrade_required/);
    const legacyDuplicateCheck = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/check-photo',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        installationId,
        baseTreeRevision: 4,
        entityType: 'zone',
        entityId: zoneId,
        fieldName: 'photos[0]',
        checksum: written.checksum,
      },
    });
    assert.equal(legacyDuplicateCheck.statusCode, 200, legacyDuplicateCheck.body);
    assert.equal(legacyDuplicateCheck.json().exists, false);
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
    const duplicateCheck = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/check-photo',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        installationId,
        baseTreeRevision: 4,
        entityType: 'zone',
        entityId: zoneId,
        fieldName: 'photos[0]',
        checksum: written.checksum,
      },
    });
    assert.equal(duplicateCheck.statusCode, 200, duplicateCheck.body);
    assert.equal(duplicateCheck.json().treeRevision, 5);
    const duplicateSession = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/create-upload-session',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        installationId,
        baseTreeRevision: 4,
        entityType: 'zone',
        entityId: zoneId,
        fieldName: 'photos[0]',
        checksum: written.checksum,
        filename: 'evidence.jpg',
        fileSizeBytes: written.size,
      },
    });
    assert.equal(duplicateSession.statusCode, 200, duplicateSession.body);
    assert.equal(duplicateSession.json().alreadyExists, true);
    assert.equal(duplicateSession.json().treeRevision, 5);
    for (const baseTreeRevision of [5]) {
      const afterLocalRevisionCheck = await app.inject({
        method: 'POST',
        url: '/v1/installhub/sync/check-photo',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          installationId,
          baseTreeRevision,
          entityType: 'zone',
          entityId: zoneId,
          fieldName: 'photos[0]',
          checksum: written.checksum,
        },
      });
      assert.equal(afterLocalRevisionCheck.statusCode, 200, afterLocalRevisionCheck.body);
      assert.equal(afterLocalRevisionCheck.json().treeRevision, 5);
      const afterLocalRevisionSession = await app.inject({
        method: 'POST',
        url: '/v1/installhub/sync/create-upload-session',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          installationId,
          baseTreeRevision,
          entityType: 'zone',
          entityId: zoneId,
          fieldName: 'photos[0]',
          checksum: written.checksum,
          filename: 'evidence.jpg',
          fileSizeBytes: written.size,
        },
      });
      assert.equal(afterLocalRevisionSession.statusCode, 200, afterLocalRevisionSession.body);
      assert.equal(afterLocalRevisionSession.json().treeRevision, 5);
    }
    await db.insert(photoRegistry).values({
      id: racedSessionId,
      checksum: written.checksum,
      storageKey,
      contentType: 'image/jpeg',
      originalFilename: 'raced-evidence.jpg',
      app: 'installhub',
      parentId: installationId,
      entityType: 'zone',
      entityId: zoneId,
      fieldName: 'photos[1]',
      fileSizeBytes: written.size,
      status: 'uploaded',
      baseTreeRevision: 5,
      uploadedAt: new Date(),
    });
    await db.update(ihInstallations).set({ treeRevision: 6 })
      .where(eq(ihInstallations.id, installationId));
    const racedConfirmation = await app.inject({
      method: 'POST',
      url: '/v1/installhub/sync/confirm-upload',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: racedSessionId, checksum: written.checksum },
    });
    assert.equal(racedConfirmation.statusCode, 409, racedConfirmation.body);
    assert.match(racedConfirmation.json().detail, /snapshot_conflict/);
    const [unconfirmedRace] = await db.select({
      status: photoRegistry.status,
      confirmedTreeRevision: photoRegistry.confirmedTreeRevision,
    }).from(photoRegistry).where(eq(photoRegistry.id, racedSessionId));
    assert.deepEqual(unconfirmedRace, {
      status: 'uploaded',
      confirmedTreeRevision: null,
    });
    const [installationAfterRace] = await db.select({
      treeRevision: ihInstallations.treeRevision,
    }).from(ihInstallations).where(eq(ihInstallations.id, installationId));
    assert.equal(installationAfterRace.treeRevision, 6);
    await db.update(ihInstallations).set({ treeRevision: 5 })
      .where(eq(ihInstallations.id, installationId));
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
    await purgeInstallHubInstallationTree(freshInstallationId).catch(() => {});
    await purgeInstallHubInstallationTree(derivedSiteCodeInstallationId).catch(() => {});
    await purgeInstallHubInstallationTree(invalidSiteCodeInstallationId).catch(() => {});
    await purgeInstallHubInstallationTree(importedCopyId).catch(() => {});
    await app.close();
    await closeDb();
  }
});
