import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { CanonicalInstallationTree, DisplayCode } from './canonical.js';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

function display(value: string): DisplayCode {
  return {
    value,
    generatedValue: value,
    isOverridden: false,
    ruleVersion: 4,
  };
}

test('meter lifecycle state persists, loads canonically, and projects to legacy clients', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    { ihInstallations, ihMeterDevices },
    { eq },
    {
      loadCanonicalInstallationTree,
      projectLegacyInstallationTree,
      replaceCanonicalInstallationChildren,
    },
    { purgeInstallHubInstallationTree },
  ] = await Promise.all([
    import('../../db/client.js'),
    import('../../db/schema/installhub.js'),
    import('drizzle-orm'),
    import('./treeService.js'),
    import('./purge.js'),
  ]);
  const installationId = randomUUID();
  const prefix = `life-${randomUUID().slice(0, 8)}`;
  const gridId = `${prefix}-grid`;
  const zoneId = `${prefix}-zone`;
  const boardId = `${prefix}-board`;
  const meterId = `${prefix}-meter`;
  const tree: CanonicalInstallationTree = {
    treeSchemaVersion: 2,
    installation: {
      id: installationId,
      externalKey: `${prefix}-external`,
      siteCode: 'LIFECYCLE',
      timezone: 'Australia/Sydney',
      clientName: 'Lifecycle client',
      siteName: 'Lifecycle site',
      siteAddress: '1 Test Street',
      inspectorName: 'Integration Inspector',
      auditDate: '2026-09-06',
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
    }],
    zones: [{
      id: zoneId,
      installationId,
      zoneCode: 'METER-ROOM',
      zoneName: 'Meter room',
      zoneDescription: '',
      photos: [],
    }],
    electricalAssets: [{
      id: boardId,
      installationId,
      zoneId,
      assetName: 'Main switchboard',
      typeCode: 'MSB',
      displayCode: display(`${prefix.toUpperCase()}-MSB-001`),
      electricalSource: { kind: 'GRID', gridSupplyId: gridId },
      extraPhotos: [],
      meterPresent: true,
    }],
    siteAssets: [],
    meterDevices: [{
      id: meterId,
      installationId,
      installedOnBoardId: boardId,
      customName: 'Historical inactive meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      lifecycleState: 'INACTIVE',
      deviceNumber: `${prefix}-device`,
      serialNumber: `${prefix}-serial`,
      displayName: display(`${prefix.toUpperCase()}-A3RM-001`),
      channels: [1, 2, 3].map((ordinal) => ({
        id: `${prefix}-channel-${ordinal}`,
        ordinal,
        purpose: 'SUB_CIRCUIT' as const,
        sensorRating: '120A',
        capabilities: {},
      })),
      wwPhotos: {},
    }],
    measurementAssignments: [],
    formSubmissions: [],
    serverDerived: { virtualMeterDefinitions: [] },
  };

  try {
    await db.insert(ihInstallations).values({
      id: installationId,
      externalKey: tree.installation.externalKey,
      siteCode: tree.installation.siteCode,
      timezone: tree.installation.timezone,
      treeSchemaVersion: 2,
      treeRevision: 1,
      recordVersionNumber: 0,
      clientName: tree.installation.clientName,
      siteName: tree.installation.siteName,
      siteAddress: tree.installation.siteAddress,
      inspectorName: tree.installation.inspectorName,
      auditDate: tree.installation.auditDate,
      status: 'Draft',
    });
    await db.transaction(async (tx) => {
      await replaceCanonicalInstallationChildren({ executor: tx, tree });
    });

    const [storedInactive] = await db.select({
      lifecycleState: ihMeterDevices.lifecycleState,
    }).from(ihMeterDevices).where(eq(ihMeterDevices.id, meterId));
    assert.equal(storedInactive?.lifecycleState, 'INACTIVE');

    const loadedInactive = await loadCanonicalInstallationTree(installationId, db);
    assert.ok(loadedInactive);
    assert.equal(loadedInactive.meterDevices[0]?.lifecycleState, 'INACTIVE');
    const legacy = projectLegacyInstallationTree(loadedInactive);
    assert.equal(legacy.meterDevices[0]?.lifecycleState, 'INACTIVE');
    assert.equal(legacy.electricalAssets[0]?.meters[0]?.lifecycleState, 'INACTIVE');

    loadedInactive.meterDevices[0].lifecycleState = 'ACTIVE';
    await db.transaction(async (tx) => {
      await replaceCanonicalInstallationChildren({ executor: tx, tree: loadedInactive });
    });
    const [storedActive] = await db.select({
      lifecycleState: ihMeterDevices.lifecycleState,
    }).from(ihMeterDevices).where(eq(ihMeterDevices.id, meterId));
    assert.equal(storedActive?.lifecycleState, 'ACTIVE');
    assert.equal(
      (await loadCanonicalInstallationTree(installationId, db))?.meterDevices[0]?.lifecycleState,
      'ACTIVE',
    );
  } finally {
    await purgeInstallHubInstallationTree(installationId).catch(() => {});
    await closeDb();
  }
});
