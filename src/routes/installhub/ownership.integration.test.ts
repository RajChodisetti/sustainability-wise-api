import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { CanonicalInstallationTree, DisplayCode } from './canonical.js';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

function display(value: string): DisplayCode {
  return {
    value,
    generatedValue: value,
    isOverridden: false,
    ruleVersion: 1,
  };
}

function fullTree(installationId: string, prefix: string): CanonicalInstallationTree {
  const gridId = `${prefix}-grid`;
  const zoneId = `${prefix}-zone`;
  const boardId = `${prefix}-board`;
  const assetId = `${prefix}-asset`;
  const meterId = `${prefix}-meter`;
  const channelIds = [1, 2, 3].map((ordinal) => `${prefix}-channel-${ordinal}`);
  const assignmentId = `${prefix}-assignment`;
  return {
    treeSchemaVersion: 2,
    installation: {
      id: installationId,
      externalKey: `${prefix}-external`,
      siteCode: prefix.toUpperCase().slice(0, 12),
      timezone: 'Australia/Sydney',
      clientName: `${prefix} client`,
      siteName: `${prefix} site`,
      siteAddress: '1 Test Street',
      inspectorName: 'Integration Inspector',
      auditDate: '2026-08-01',
      status: 'Draft',
      treeSchemaVersion: 2,
      treeRevision: 1,
      recordVersionNumber: 0,
    },
    gridSupplies: [{
      id: gridId,
      installationId,
      name: 'Grid',
      isDefault: true,
      nmi: `${prefix}-NMI`,
    }],
    zones: [{
      id: zoneId,
      installationId,
      zoneCode: 'SOURCE-ZONE',
      zoneName: 'Source zone',
      zoneDescription: '',
      photos: [],
    }],
    electricalAssets: [{
      id: boardId,
      installationId,
      zoneId,
      assetName: 'Source board',
      typeCode: 'MSB',
      displayCode: display(`${prefix.toUpperCase()}-MSB-001`),
      electricalSource: { kind: 'GRID', gridSupplyId: gridId },
      extraPhotos: [],
      meterPresent: true,
    }],
    siteAssets: [{
      id: assetId,
      installationId,
      zoneId,
      assetName: 'Source asset',
      typeCode: 'HVAC',
      displayCode: display(`${prefix.toUpperCase()}-HVAC-001`),
      electricalSource: { kind: 'BOARD', boardId },
      meteringState: { kind: 'METERED', measurementAssignmentIds: [assignmentId] },
      meterPresent: true,
      extraPhotos: [],
    }],
    meterDevices: [{
      id: meterId,
      installationId,
      installedOnBoardId: boardId,
      customName: 'A3RM Meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      deviceNumber: `${prefix}-device`,
      serialNumber: `${prefix}-serial`,
      displayName: display(`${prefix.toUpperCase()}-A3RM-001`),
      channels: channelIds.map((id, index) => ({
        id,
        ordinal: index + 1,
        purpose: 'SUB_CIRCUIT',
        loadTypeCode: 'HVAC',
        sensorRating: '120A',
        capabilities: {},
      })),
      wwPhotos: {},
    }],
    measurementAssignments: [{
      id: assignmentId,
      installationId,
      meterId,
      channelIds,
      phaseMode: 'THREE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: assetId },
      direction: 'CONSUMPTION',
      status: 'CONFIRMED',
    }],
    formSubmissions: [{
      id: `${prefix}-form`,
      installationId,
      formType: 'ww-installation',
      schemaVersion: 2,
      status: 'Draft',
      zoneId,
      boardId,
      meterId,
      siteAssetId: assetId,
      answers: {},
      attachments: [],
    }],
    serverDerived: { virtualMeterDefinitions: [] },
  };
}

function retargetTree(
  source: CanonicalInstallationTree,
  installationId: string,
  externalKey: string,
): CanonicalInstallationTree {
  const tree = structuredClone(source);
  tree.installation.id = installationId;
  tree.installation.externalKey = externalKey;
  tree.installation.clientName = 'Attempted thief';
  tree.installation.siteName = 'Attempted thief';
  for (const child of [
    ...tree.gridSupplies,
    ...tree.zones,
    ...tree.electricalAssets,
    ...tree.siteAssets,
    ...tree.meterDevices,
    ...tree.measurementAssignments,
    ...tree.formSubmissions,
  ]) {
    child.installationId = installationId;
  }
  return tree;
}

function genericOwnershipConflict(error: unknown): boolean {
  return error instanceof Error
    && 'statusCode' in error
    && error.statusCode === 409
    && 'detail' in error
    && error.detail === 'canonical_child_id_conflict';
}

test('canonical child IDs cannot cross installation ownership, including a concurrent new-ID collision', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb, sql },
    schema,
    { eq },
    { loadCanonicalInstallationTree, replaceCanonicalInstallationChildren },
    { purgeInstallHubInstallationTree },
  ] = await Promise.all([
    import('../../db/client.js'),
    import('../../db/schema/installhub.js'),
    import('drizzle-orm'),
    import('./treeService.js'),
    import('./purge.js'),
  ]);
  const {
    ihCompletionIdempotency,
    ihDisplayCodeClaims,
    ihInstallations,
    ihZones,
  } = schema;
  const sourceInstallationId = randomUUID();
  const targetInstallationId = randomUUID();
  const prefix = `own-${randomUUID().slice(0, 8)}`;
  const sourceTree = fullTree(sourceInstallationId, prefix);
  const insertInstallation = (id: string, externalKey: string, name: string) => (
    db.insert(ihInstallations).values({
      id,
      externalKey,
      siteCode: 'OWN',
      timezone: 'Australia/Sydney',
      treeSchemaVersion: 2,
      treeRevision: 1,
      recordVersionNumber: 0,
      clientName: name,
      siteName: name,
      siteAddress: '1 Test Street',
      inspectorName: 'Integration Inspector',
      auditDate: '2026-08-01',
      status: 'Draft',
    })
  );

  try {
    await insertInstallation(sourceInstallationId, sourceTree.installation.externalKey, 'Owner');
    await insertInstallation(targetInstallationId, `${prefix}-target`, 'Target');
    await db.transaction(async (tx) => {
      await replaceCanonicalInstallationChildren({ executor: tx, tree: sourceTree });
    });
    await db.insert(ihCompletionIdempotency).values({
      id: `${prefix}-completion`,
      installationId: sourceInstallationId,
      operation: 'complete',
      actorUserId: `${prefix}-actor`,
      idempotencyKey: `${prefix}-key`,
      requestFingerprint: `${prefix}-fingerprint`,
      completedFromRevision: 1,
      resultingTreeRevision: 2,
      recordVersionNumber: 1,
      result: {},
    });

    const before = await loadCanonicalInstallationTree(sourceInstallationId, db);
    assert.ok(before);
    assert.equal(before.zones[0].zoneCode, 'SOURCE-ZONE');
    assert.equal(before.meterDevices[0].customName, 'A3RM Meter');
    assert.ok(before.electricalAssets.every((board) => board.displayCode.ruleVersion === 3));
    assert.ok(before.siteAssets.every((asset) => asset.displayCode.ruleVersion === 3));
    assert.ok(before.meterDevices.every((meter) => meter.displayName.ruleVersion === 3));
    const stolenTree = retargetTree(before, targetInstallationId, `${prefix}-target`);
    stolenTree.zones[0].zoneName = 'Stolen and mutated';
    await assert.rejects(
      db.transaction(async (tx) => {
        await replaceCanonicalInstallationChildren({ executor: tx, tree: stolenTree });
      }),
      genericOwnershipConflict,
    );
    assert.deepEqual(
      await loadCanonicalInstallationTree(sourceInstallationId, db),
      before,
    );
    const targetAfterRejectedWrite = await loadCanonicalInstallationTree(targetInstallationId, db);
    assert.ok(targetAfterRejectedWrite);
    assert.equal(targetAfterRejectedWrite.zones.length, 0);

    const [displayClaim] = await db.select({
      id: ihDisplayCodeClaims.id,
      zoneId: ihDisplayCodeClaims.zoneId,
      sequence: ihDisplayCodeClaims.sequence,
      ruleVersion: ihDisplayCodeClaims.ruleVersion,
    })
      .from(ihDisplayCodeClaims)
      .where(eq(ihDisplayCodeClaims.installationId, sourceInstallationId))
      .limit(1);
    assert.ok(displayClaim);
    assert.equal(displayClaim.zoneId, sourceTree.zones[0].id);
    assert.ok((displayClaim.sequence ?? 0) >= 1);
    assert.equal(displayClaim.ruleVersion, 3);
    const guardedRows = [
      ['ih_grid_supplies', `${prefix}-grid`],
      ['ih_zones', `${prefix}-zone`],
      ['ih_electrical_assets', `${prefix}-board`],
      ['ih_site_assets', `${prefix}-asset`],
      ['ih_meter_devices', `${prefix}-meter`],
      ['ih_meter_channels', `${prefix}-channel-1`],
      ['ih_measurement_assignments', `${prefix}-assignment`],
      ['ih_measurement_assignment_channels', `${prefix}-assignment:${prefix}-channel-1`],
      ['ih_form_submissions', `${prefix}-form`],
      ['ih_display_code_claims', displayClaim.id],
      ['ih_completion_idempotency', `${prefix}-completion`],
    ] as const;
    for (const [tableName, id] of guardedRows) {
      await assert.rejects(
        sql.unsafe(
          `UPDATE "${tableName}" SET "installation_id" = $1 WHERE "id" = $2`,
          [targetInstallationId, id],
        ),
        (error: unknown) => (
          error instanceof Error
          && 'constraint_name' in error
          && error.constraint_name === 'ih_canonical_child_installation_immutable'
        ),
      );
    }
    assert.deepEqual(
      await loadCanonicalInstallationTree(sourceInstallationId, db),
      before,
    );

    const racingZoneId = `${prefix}-concurrent-zone`;
    let signalInserted!: () => void;
    let releaseInsert!: () => void;
    const inserted = new Promise<void>((resolve) => { signalInserted = resolve; });
    const release = new Promise<void>((resolve) => { releaseInsert = resolve; });
    const concurrentOwner = db.transaction(async (tx) => {
      await tx.insert(ihZones).values({
        id: racingZoneId,
        installationId: sourceInstallationId,
        zoneName: 'Concurrent owner',
      });
      signalInserted();
      await release;
    });
    await inserted;

    const concurrentTarget = fullTree(targetInstallationId, `${prefix}-race`);
    concurrentTarget.gridSupplies = [];
    concurrentTarget.zones = [{
      id: racingZoneId,
      installationId: targetInstallationId,
      zoneCode: 'CONCURRENT-THIEF',
      zoneName: 'Concurrent thief',
      zoneDescription: '',
      photos: [],
    }];
    concurrentTarget.electricalAssets = [];
    concurrentTarget.siteAssets = [];
    concurrentTarget.meterDevices = [];
    concurrentTarget.measurementAssignments = [];
    concurrentTarget.formSubmissions = [];
    const concurrentSteal = db.transaction(async (tx) => {
      await replaceCanonicalInstallationChildren({ executor: tx, tree: concurrentTarget });
    });
    await delay(25);
    releaseInsert();
    await concurrentOwner;
    await assert.rejects(concurrentSteal, genericOwnershipConflict);
    const [racingZone] = await db.select({
      installationId: ihZones.installationId,
      zoneName: ihZones.zoneName,
    }).from(ihZones).where(eq(ihZones.id, racingZoneId));
    assert.deepEqual(racingZone, {
      installationId: sourceInstallationId,
      zoneName: 'Concurrent owner',
    });
  } finally {
    await purgeInstallHubInstallationTree(targetInstallationId).catch(() => {});
    await purgeInstallHubInstallationTree(sourceInstallationId).catch(() => {});
    await closeDb();
  }
});
