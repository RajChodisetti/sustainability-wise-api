import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('meter commissioning metadata round-trips and an omitting client cannot erase it', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { buildApp },
    { closeDb },
    { signAccessToken },
    { purgeInstallHubInstallationTree },
  ] = await Promise.all([
    import('../../app.js'),
    import('../../db/client.js'),
    import('../../auth/jwt.js'),
    import('./purge.js'),
  ]);
  const app = await buildApp();
  const installationId = randomUUID();
  const userId = randomUUID();
  const gridId = randomUUID();
  const zoneId = randomUUID();
  const boardId = randomUUID();
  const meterId = randomUUID();
  const token = signAccessToken({ userId, app: 'installhub', role: 'inspector' });
  const commissioningData = {
    classification: 'Electricity meter',
    coverage: 'Main switchboard incoming supply',
    prestart: {
      siteInduction: true,
      safeAccess: true,
      correctPpe: true,
      livePointsAware: true,
      canIsolate: true,
      additionalHazards: false,
      safeToProceed: true,
    },
    switchboard: {
      name: 'Main Switchboard',
      location: 'Plant room north wall',
      deviceSerial: null,
      firmware: 'QA',
      antennaType: 'Internal',
      signalStrength: 'Verified',
      notes: null,
    },
    verification: {
      voltageChecked: true,
      polarityChecked: true,
      communicationsOk: true,
      notes: 'Three-phase mapping verified',
    },
    commissioning: {
      deviceOnline: true,
      channelsReporting: true,
      labeled: true,
      photosTaken: false,
      notes: 'Commissioned in QA',
    },
  };
  const payload = {
    syncStage: 'metadata',
    treeSchemaVersion: 2,
    baseTreeRevision: 0,
    installation: {
      id: installationId,
      externalKey: `local:${installationId}`,
      siteCode: 'METERQA',
      timezone: 'Australia/Sydney',
      treeSchemaVersion: 2,
      treeRevision: 0,
      recordVersionNumber: 0,
      clientName: 'Meter QA',
      siteName: 'Meter QA',
      siteAddress: '1 Test Street',
      inspectorName: 'Test Inspector',
      auditDate: '2026-08-02',
      status: 'Draft',
    },
    gridSupplies: [{
      id: gridId,
      installationId,
      name: 'Grid supply',
      isDefault: true,
    }],
    zones: [{
      id: zoneId,
      installationId,
      zoneName: 'Plant room',
      zoneDescription: '',
      photos: [],
    }],
    electricalAssets: [{
      id: boardId,
      installationId,
      zoneId,
      assetName: 'Main Switchboard',
      typeCode: 'MSB',
      displayCode: {
        value: 'METERQA-MSB-001',
        generatedValue: 'METERQA-MSB-001',
        isOverridden: false,
        ruleVersion: 1,
      },
      electricalSource: { kind: 'GRID', gridSupplyId: gridId },
      extraPhotos: [],
      meterPresent: true,
    }],
    siteAssets: [],
    meterDevices: [{
      id: meterId,
      installationId,
      installedOnBoardId: boardId,
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      serialNumber: 'SERIAL-1',
      displayName: {
        value: 'METERQA-A3RM-001',
        generatedValue: 'METERQA-A3RM-001',
        isOverridden: false,
        ruleVersion: 1,
      },
      channels: [1, 2, 3].map((ordinal) => ({
        id: `${meterId}:${ordinal}`,
        ordinal,
        purpose: 'SPARE',
        capabilities: {},
      })),
      commissioningData,
      wwPhotos: {},
    }],
    measurementAssignments: [],
    formSubmissions: [],
    serverDerived: { virtualMeterDefinitions: [] },
  };
  const push = (tree: Record<string, unknown>) => app.inject({
    method: 'POST',
    url: '/v1/installhub/sync/push',
    headers: { authorization: `Bearer ${token}` },
    payload: tree,
  });
  const pull = () => app.inject({
    method: 'GET',
    url: `/v1/installhub/sync/pull?since=1970-01-01T00%3A00%3A00.000Z&installationId=${installationId}`,
    headers: { authorization: `Bearer ${token}` },
  });

  try {
    const created = await push(payload);
    assert.equal(created.statusCode, 200, created.body);
    const firstPull = await pull();
    assert.equal(firstPull.statusCode, 200, firstPull.body);
    const firstTree = firstPull.json().installations[0];
    assert.deepEqual(firstTree.meterDevices[0].commissioningData, commissioningData);
    assert.equal(firstTree.electricalAssets[0].meters[0].classification, 'Electricity meter');
    assert.equal(firstTree.electricalAssets[0].meters[0].wwPrestart.safeToProceed, true);
    assert.equal(firstTree.electricalAssets[0].meters[0].wwVerification.communicationsOk, true);
    assert.equal(firstTree.electricalAssets[0].meters[0].wwCommissioning.channelsReporting, true);

    const omittingClient = structuredClone(payload);
    omittingClient.installation = structuredClone(firstTree.installation);
    omittingClient.syncStage = 'metadata';
    omittingClient.baseTreeRevision = 1;
    delete (omittingClient.meterDevices[0] as { commissioningData?: unknown }).commissioningData;
    omittingClient.installation.siteAddress = '2 Updated Street';
    const updated = await push(omittingClient);
    assert.equal(updated.statusCode, 200, updated.body);
    const afterOmission = await pull();
    assert.deepEqual(
      afterOmission.json().installations[0].meterDevices[0].commissioningData,
      commissioningData,
    );
  } finally {
    await purgeInstallHubInstallationTree(installationId).catch(() => {});
    await app.close();
    await closeDb();
  }
});
