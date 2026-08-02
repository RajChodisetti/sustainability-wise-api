import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deterministicLegacyGridId,
  planLegacyInstallationBackfill,
  type LegacyBoardRow,
  type LegacySiteAssetRow,
} from './legacyBackfill.js';

const CREATED = new Date('2026-01-01T00:00:00.000Z');
const UPDATED = new Date('2026-02-01T00:00:00.000Z');

function board(overrides: Partial<LegacyBoardRow> = {}): LegacyBoardRow {
  return {
    id: 'board-1',
    installationId: 'installation-1',
    assetType: 'Main Snachboard',
    displayCode: 'SITE-MSB-001',
    electricalParentId: null,
    electricalParentTbc: false,
    siteNmi: 'NMI-1',
    meterPresent: false,
    meters: [],
    createdAt: CREATED,
    updatedAt: UPDATED,
    deletedAt: null,
    ...overrides,
  };
}

function asset(overrides: Partial<LegacySiteAssetRow> = {}): LegacySiteAssetRow {
  return {
    id: 'asset-1',
    installationId: 'installation-1',
    assetType: 'Lightning',
    displayCode: 'SITE-LIGHTING-001',
    electricalBoardId: 'board-1',
    electricalBoardTbc: false,
    meterPresent: false,
    meterSwitchboardId: null,
    meterSwitchboardTbc: false,
    meterChannels: [],
    createdAt: CREATED,
    updatedAt: UPDATED,
    deletedAt: null,
    ...overrides,
  };
}

function stableMeter() {
  return {
    id: 'meter-1',
    deviceFamily: 'WATTWATCHERS',
    deviceType: 'A3RM',
    deviceId: 'serial-1',
    deviceNumber: 'device-1',
    deviceName: 'SITE-A3RM-001',
    wwPhotos: {
      deviceInstalled: 'https://api.example.test/photo.jpg',
    },
    wwChannels: [1, 2, 3].map((ordinal) => ({
      id: `meter-1:${ordinal}`,
      ordinal,
      purpose: ordinal === 1 ? 'MAIN_SUPPLY' : 'SUB_CIRCUIT',
      loadType: ordinal === 1 ? 'Mains Supply' : 'HVAC',
      rogowskiSize: '3000A - 9cm',
      capabilities: { measuresActivePower: true },
    })),
  };
}

function existingStableMeter(id = 'meter-1') {
  return {
    id,
    installedOnBoardId: 'board-1',
    deviceFamily: 'WATTWATCHERS' as const,
    deviceModel: 'A3RM' as const,
    customManufacturerName: null,
    customModelName: null,
    deviceNumber: 'device-1',
    serialNumber: 'serial-1',
    displayCode: 'SITE-A3RM-001',
    channels: [1, 2, 3].map((ordinal) => ({
      id: `${id}:${ordinal}`,
      ordinal,
      purpose: ordinal === 1 ? 'MAIN_SUPPLY' as const : 'SUB_CIRCUIT' as const,
      phaseLabel: null,
      loadTypeCode: ordinal === 1 ? null : 'HVAC' as const,
      customLoadTypeName: null,
      sensorRating: '3000A - 9cm',
      description: null,
      capabilities: { measuresActivePower: true },
    })),
  };
}

test('backfill creates a deterministic default Grid but never guesses null+false supply', () => {
  const first = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board()],
    siteAssets: [asset()],
  });
  const second = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board()],
    siteAssets: [asset()],
  });
  assert.deepEqual(first, second);
  assert.equal(first.deterministicGrid?.id, deterministicLegacyGridId('installation-1'));
  assert.equal(first.deterministicGrid?.isDefault, true);
  assert.equal(first.deterministicGrid?.nmi, 'NMI-1');
  assert.deepEqual(first.boardUpdates[0], {
    id: 'board-1',
    typeCode: 'MSB',
    customTypeName: null,
    sourceKind: 'TBC',
    electricalParentId: null,
    electricalParentTbc: true,
    displayCodeOverridden: false,
  });
  assert.deepEqual(
    first.displayClaims.find((claim) => claim.entityId === 'board-1'),
    {
      id: first.displayClaims.find((claim) => claim.entityId === 'board-1')!.id,
      entityType: 'board',
      entityId: 'board-1',
      typeCode: 'MSB',
      displayCode: 'SITE-MSB-001',
      normalizedDisplayCode: 'SITE-MSB-001',
      sequence: 1,
      generated: true,
    },
  );
  assert.equal(first.siteAssetUpdates[0].typeCode, 'LIGHTING');
  assert.ok(first.exceptions.some((item) => item.code === 'AMBIGUOUS_LEGACY_SOURCE'));
  assert.equal(first.promotable, true);
});

test('backfill blocks ambiguous or reserved electrical graph node identities', () => {
  const collision = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [{
      id: 'board-1',
      nmi: null,
      externalKey: null,
      isDefault: true,
      deletedAt: null,
    }],
    boards: [board()],
    siteAssets: [asset()],
  });
  assert.equal(collision.promotable, false);
  assert.ok(collision.exceptions.some((item) => item.code === 'ELECTRICAL_NODE_ID_COLLISION'));

  const reserved = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ id: 'virtual_impersonation' })],
    siteAssets: [],
  });
  assert.equal(reserved.promotable, false);
  assert.ok(reserved.exceptions.some((item) => item.code === 'RESERVED_ELECTRICAL_NODE_ID'));
});

test('stable embedded meter/channel identities migrate without inventing assignments', () => {
  const legacyBoard = board({ meterPresent: true, meters: [stableMeter()] });
  const plan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [legacyBoard],
    siteAssets: [asset()],
  });
  assert.equal(plan.meterDevices.length, 1);
  assert.equal(plan.meterDevices[0].id, 'meter-1');
  assert.equal(plan.meterDevices[0].createdAt, CREATED);
  assert.deepEqual(
    plan.meterDevices[0].channels.map((channel) => [channel.id, channel.ordinal]),
    [['meter-1:1', 1], ['meter-1:2', 2], ['meter-1:3', 3]],
  );
  assert.equal(plan.promotable, true);

  const rerun = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [{ id: deterministicLegacyGridId('installation-1'), isDefault: true, deletedAt: null }],
    boards: [legacyBoard],
    siteAssets: [asset()],
    existingMeters: [existingStableMeter()],
    existingChannelIds: ['meter-1:1', 'meter-1:2', 'meter-1:3'],
  });
  assert.equal(rerun.deterministicGrid, null);
  assert.equal(rerun.meterDevices.length, 0);
  assert.equal(rerun.alreadyMigratedMeters, 1);
  assert.deepEqual(rerun.photoReconciliations, [{
    meterId: 'meter-1',
    legacyBoardId: 'board-1',
    legacyMeterIndex: 0,
  }]);
});

test('standard meters use model-defined capabilities while custom meters require explicit metadata', () => {
  const meterWithCapabilities = stableMeter();
  const standard = {
    ...meterWithCapabilities,
    wwChannels: meterWithCapabilities.wwChannels.map(({ capabilities: _capabilities, ...channel }) => channel),
  };
  const standardPlan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [standard] })],
    siteAssets: [asset()],
  });
  assert.equal(
    standardPlan.exceptions.some((item) => item.code === 'MISSING_METER_CAPABILITY'),
    false,
  );
  assert.equal(standardPlan.promotable, true);
  assert.ok(standardPlan.meterDevices[0].channels.every((channel) => (
    Object.keys(channel.capabilities).length === 0
  )));

  const custom = {
    ...standard,
    deviceFamily: 'OTHER',
    deviceType: 'Custom Meter',
  };
  const customPlan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [custom] })],
    siteAssets: [asset()],
  });
  assert.equal(
    customPlan.exceptions.filter((item) => item.code === 'MISSING_METER_CAPABILITY').length,
    3,
  );
  assert.equal(customPlan.promotable, false);
});

test('ambiguous meter/channel and site measurement mappings remain blocking exceptions', () => {
  const invalidMeter = { ...stableMeter(), id: '', wwChannels: [{ ordinal: 1 }] };
  const plan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [invalidMeter] })],
    siteAssets: [asset({
      meterPresent: true,
      meterChannels: [{ channel: '1', description: 'legacy label only' }],
    })],
  });
  assert.equal(plan.meterDevices.length, 0);
  assert.equal(plan.promotable, false);
  assert.ok(plan.exceptions.some((item) => item.code === 'AMBIGUOUS_METER_IDENTITY'));
  assert.ok(plan.exceptions.some((item) => item.code === 'AMBIGUOUS_MEASUREMENT_MAPPING'));
});

test('deleted timestamps and soft-delete state are preserved on planned meters', () => {
  const deletedAt = new Date('2026-03-01T00:00:00.000Z');
  const plan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({
      meterPresent: true,
      meters: [stableMeter()],
      deletedAt,
    })],
    siteAssets: [],
  });
  assert.equal(plan.meterDevices[0].createdAt, CREATED);
  assert.equal(plan.meterDevices[0].updatedAt, UPDATED);
  assert.equal(plan.meterDevices[0].deletedAt, deletedAt);
});

test('legacy site mapping is created only for one exact meter and one/three non-spare channels', () => {
  const plan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [stableMeter()] })],
    siteAssets: [asset({
      meterPresent: true,
      meterSwitchboardId: 'board-1',
      meterChannels: [{ channel: '2', description: 'HVAC', direction: 'CONSUMPTION' }],
    })],
  });
  assert.equal(plan.measurementAssignments.length, 1);
  assert.equal(plan.measurementAssignments[0].meterId, 'meter-1');
  assert.deepEqual(plan.measurementAssignments[0].channelIds, ['meter-1:2']);
  assert.equal(plan.measurementAssignments[0].phaseMode, 'SINGLE_PHASE');
  assert.equal(plan.measurementAssignments[0].direction, 'CONSUMPTION');
  assert.equal(plan.siteAssetUpdates[0].meteringStateKind, 'METERED');
  assert.deepEqual(
    plan.siteAssetUpdates[0].measurementAssignmentIds,
    [plan.measurementAssignments[0].id],
  );
  assert.equal(plan.exceptions.some((item) => item.code === 'AMBIGUOUS_MEASUREMENT_MAPPING'), false);
});

test('legacy site mapping remains TBC when board/meter/channel resolution is not unique', () => {
  const duplicateMeter = {
    ...stableMeter(),
    id: 'meter-2',
    deviceId: 'serial-2',
    wwChannels: stableMeter().wwChannels.map((channel) => ({
      ...channel,
      id: channel.id.replace('meter-1', 'meter-2'),
    })),
  };
  const plan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [stableMeter(), duplicateMeter] })],
    siteAssets: [asset({
      meterPresent: true,
      meterSwitchboardId: 'board-1',
      meterChannels: [{ channel: '2', description: 'HVAC', direction: 'CONSUMPTION' }],
    })],
  });
  assert.equal(plan.measurementAssignments.length, 0);
  assert.equal(plan.siteAssetUpdates[0].meteringStateKind, 'TBC');
  assert.ok(plan.exceptions.some((item) => item.code === 'AMBIGUOUS_MEASUREMENT_MAPPING'));
});

test('completed WW form links only on one exact board/model/serial/device match', () => {
  const form = {
    id: 'form-1',
    formType: 'ww-installation',
    status: 'Completed',
    boardId: 'board-1',
    meterId: null,
    answers: {
      'device.type': 'A3RM',
      'device.number': 'device-1',
      'device.id': 'serial-1',
    },
  };
  const exact = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [stableMeter()] })],
    siteAssets: [],
    forms: [form],
  });
  assert.deepEqual(exact.formUpdates, [{ id: 'form-1', meterId: 'meter-1' }]);
  assert.equal(exact.exceptions.some((item) => item.code === 'AMBIGUOUS_FORM_METER_LINK'), false);

  const zero = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board()],
    siteAssets: [],
    forms: [form],
  });
  assert.equal(zero.formUpdates.length, 0);
  assert.ok(zero.exceptions.some((item) => item.code === 'AMBIGUOUS_FORM_METER_LINK'));

  const existing = (id: string) => ({ ...existingStableMeter(id), channels: [] });
  const multiple = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board()],
    siteAssets: [],
    forms: [form],
    existingMeters: [existing('meter-1'), existing('meter-2')],
  });
  assert.equal(multiple.formUpdates.length, 0);
  assert.ok(multiple.exceptions.some((item) => item.code === 'AMBIGUOUS_FORM_METER_LINK'));
});

test('non-pattern legacy display codes remain explicit override claims', () => {
  const plan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ displayCode: 'Legacy Main Board' })],
    siteAssets: [],
  });
  assert.equal(plan.boardUpdates[0].displayCodeOverridden, true);
  assert.equal(plan.displayClaims[0].generated, false);
  assert.equal(plan.displayClaims[0].sequence, null);
});

test('legacy direction is never guessed and explicit generation is preserved', () => {
  const unknown = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [stableMeter()] })],
    siteAssets: [asset({
      meterPresent: true,
      meterSwitchboardId: 'board-1',
      meterChannels: [{ channel: '2' }],
    })],
  });
  assert.equal(unknown.measurementAssignments.length, 0);
  assert.equal(unknown.siteAssetUpdates[0].meteringStateKind, 'TBC');
  assert.ok(unknown.exceptions.some((item) => item.code === 'AMBIGUOUS_MEASUREMENT_DIRECTION'));

  const generation = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [stableMeter()] })],
    siteAssets: [asset({
      meterPresent: true,
      meterSwitchboardId: 'board-1',
      meterChannels: [{ channel: '2', direction: 'GENERATION' }],
    })],
  });
  assert.equal(generation.measurementAssignments[0].direction, 'GENERATION');
});

test('interrupted same-id meter and assignment conflicts block instead of duplicating', () => {
  const conflictingMeter = existingStableMeter();
  conflictingMeter.serialNumber = 'different';
  const meterPlan = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [stableMeter()] })],
    siteAssets: [],
    existingMeters: [conflictingMeter],
    existingChannelIds: conflictingMeter.channels.map((channel) => channel.id),
  });
  assert.equal(meterPlan.photoReconciliations.length, 0);
  assert.ok(meterPlan.exceptions.some((item) => item.code === 'CONFLICTING_CANONICAL_METER'));

  const mappedAsset = asset({
    meterPresent: true,
    meterSwitchboardId: 'board-1',
    meterChannels: [{ channel: '2', direction: 'GENERATION' }],
  });
  const divergent = planLegacyInstallationBackfill({
    installationId: 'installation-1',
    siteCode: 'SITE',
    grids: [],
    boards: [board({ meterPresent: true, meters: [stableMeter()] })],
    siteAssets: [mappedAsset],
    existingAssignments: [{
      id: 'different-id',
      meterId: 'meter-1',
      channelIds: ['meter-1:2'],
      targetKind: 'SITE_ASSET',
      targetSiteAssetId: 'asset-1',
      direction: 'CONSUMPTION',
      status: 'CONFIRMED',
      deletedAt: null,
    }],
  });
  assert.equal(divergent.measurementAssignments.length, 0);
  assert.ok(divergent.exceptions.some((item) => item.code === 'CONFLICTING_CANONICAL_ASSIGNMENT'));
});
