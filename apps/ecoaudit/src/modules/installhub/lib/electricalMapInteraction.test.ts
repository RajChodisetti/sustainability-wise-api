import assert from 'node:assert/strict';
import test from 'node:test';
import type { ElectricalTreeReadModel } from '@/modules/installhub/types/domain';
import {
  createBoard,
  createInstallationTree,
  createSiteAsset,
  createZone,
} from './model';
import {
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  ensureCanonicalTree,
} from './workflow';
import { electricalMapNodeInteractionSummary } from './electricalMapInteraction';

function interactionFixture() {
  const tree = createInstallationTree({
    clientName: 'Client',
    siteName: 'Tooltip site',
    siteAddress: '1 Test Street',
    inspectorName: 'Inspector',
    auditDate: '2026-08-08',
    siteCode: 'TIP',
    timezone: 'Australia/Sydney',
  }, {
    id: 'user-1',
    email: 'inspector@example.com',
    fullName: 'Inspector',
    role: 'admin',
  });
  tree.installation.id = 'installation-1';
  tree.gridSupplies = [{ id: 'grid-1', installationId: tree.installation.id, name: 'Incoming grid', isDefault: true }];
  const zone = createZone(tree.installation.id, { zoneName: 'Plant room', zoneDescription: '' });
  zone.id = 'zone-1';
  const board = createBoard(tree.installation.id, zone.id);
  board.id = 'board-1';
  board.assetName = 'Main switchboard';
  applyBoardElectricalSource(board, { kind: 'GRID', gridSupplyId: 'grid-1' });
  const asset = createSiteAsset(tree.installation.id, zone.id);
  asset.id = 'asset-1';
  asset.assetName = 'Chiller';
  asset.typeCode = 'AC_HVAC';
  applyAssetElectricalSource(asset, { kind: 'BOARD', boardId: board.id });
  asset.meteringState = { kind: 'METERED', measurementAssignmentIds: ['assignment-1'] };
  tree.zones = [zone];
  tree.electricalAssets = [board];
  tree.siteAssets = [asset];
  tree.meterDevices = [{
    id: 'meter-1',
    installationId: tree.installation.id,
    installedOnBoardId: board.id,
    deviceFamily: 'OTHER',
    deviceModel: 'OTHER',
    displayName: { value: 'Plant meter', generatedValue: 'Plant meter', isOverridden: false, ruleVersion: 4 },
    serialNumber: 'SERIAL-1',
    channels: [
      { id: 'channel-1', ordinal: 1, phaseLabel: 'L1', purpose: 'SUB_CIRCUIT', loadTypeCode: 'HVAC' },
      { id: 'channel-2', ordinal: 2, purpose: 'SUB_CIRCUIT', customLoadTypeName: 'PAC 1' },
      { id: 'channel-3', ordinal: 3, purpose: 'SPARE' },
    ],
  }];
  tree.measurementAssignments = [{
    id: 'assignment-1',
    installationId: tree.installation.id,
    meterId: 'meter-1',
    channelIds: ['channel-2', 'channel-1'],
    phaseMode: 'THREE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  const model: ElectricalTreeReadModel = {
    installationId: tree.installation.id,
    treeRevision: 1,
    nodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Incoming grid' },
      { id: 'board-1', kind: 'BOARD', name: 'Main switchboard' },
      { id: 'asset-1', kind: 'SITE_ASSET', name: 'Chiller', typeLabel: 'AC / HVAC' },
    ],
    edges: [
      { id: 'fed-board', sourceNodeId: 'grid-1', targetNodeId: 'board-1', relationship: 'FED_FROM' },
      { id: 'fed-asset', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'FED_FROM' },
      { id: 'measures:assignment-1', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'MEASURES' },
    ],
    unresolved: [],
  };
  return { tree: ensureCanonicalTree(tree), model };
}

test('interaction summary exposes client-facing load, meter, and exact assigned channels', () => {
  const { tree, model } = interactionFixture();
  const asset = electricalMapNodeInteractionSummary(tree, model, 'asset-1');

  assert.deepEqual(asset.loadLabels, ['AC / HVAC', 'PAC 1']);
  assert.equal(asset.downstreamLoadCount, 1);
  assert.equal(asset.meterCount, 1);
  assert.equal(asset.installedChannelCount, 3);
  assert.equal(asset.activeChannelCount, 2);
  assert.equal(asset.assignedChannelCount, 2);
  assert.deepEqual(asset.meters, [{
    id: 'meter-1',
    name: 'Plant meter',
    serialNumber: 'SERIAL-1',
    installedChannelCount: 3,
    assignedChannels: [
      { id: 'channel-1', ordinal: 1, label: 'Ch 1 · L1 · Sub-circuit · HVAC' },
      { id: 'channel-2', ordinal: 2, label: 'Ch 2 · Sub-circuit · PAC 1' },
    ],
  }]);
});

test('board and grid summaries include active installed meter capacity in their electrical scope', () => {
  const { tree, model } = interactionFixture();
  const activeMeter = tree.meterDevices?.[0];
  assert.ok(activeMeter);
  tree.meterDevices?.push({
    ...activeMeter,
    id: 'inactive-meter',
    displayName: { value: 'Inactive meter', generatedValue: 'Inactive meter', isOverridden: false, ruleVersion: 4 },
    serialNumber: 'INACTIVE-1',
    lifecycleState: 'INACTIVE',
    channels: [{ id: 'inactive-channel', ordinal: 1, purpose: 'MAIN_SUPPLY' }],
  });
  const board = electricalMapNodeInteractionSummary(tree, model, 'board-1');
  const grid = electricalMapNodeInteractionSummary(tree, model, 'grid-1');

  assert.deepEqual(board.loadLabels, ['AC / HVAC', 'PAC 1']);
  assert.equal(board.meterCount, 1);
  assert.equal(board.downstreamLoadCount, 1);
  assert.equal(board.installedChannelCount, 3);
  assert.equal(board.activeChannelCount, 2);
  assert.equal(board.assignedChannelCount, 2);
  assert.deepEqual(grid, board);
});

test('unknown nodes return an empty interaction summary', () => {
  const { tree, model } = interactionFixture();
  assert.deepEqual(electricalMapNodeInteractionSummary(tree, model, 'missing'), {
    loadLabels: [],
    downstreamLoadCount: 0,
    meters: [],
    meterCount: 0,
    installedChannelCount: 0,
    activeChannelCount: 0,
    assignedChannelCount: 0,
  });
});
