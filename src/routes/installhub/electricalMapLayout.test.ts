import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientElectricalMapNodeIds,
  electricalMapLayoutMatchesNodeIds,
  validateElectricalMapLayout,
  validStoredElectricalMapLayout,
} from './electricalMapLayout.js';

test('electrical map layouts are finite, bounded, unique and canonically ordered', () => {
  const layout = validateElectricalMapLayout({
    version: 1,
    canvas: { width: 1_200.127, height: 800.994 },
    nodes: [
      { nodeId: 'site-asset', centerX: 950.125, centerY: 400.456 },
      { nodeId: 'grid', centerX: 300.555, centerY: 400.444 },
    ],
  }, ['grid', 'site-asset']);

  assert.deepEqual(layout, {
    version: 1,
    canvas: { width: 1_200.13, height: 800.99 },
    nodes: [
      { nodeId: 'grid', centerX: 300.56, centerY: 400.44 },
      { nodeId: 'site-asset', centerX: 950.13, centerY: 400.46 },
    ],
  });
  assert.equal(electricalMapLayoutMatchesNodeIds(layout, ['site-asset', 'grid']), true);
  assert.equal(electricalMapLayoutMatchesNodeIds(layout, ['grid']), false);
});

test('electrical map layout validation rejects stale, duplicate and out-of-canvas nodes', () => {
  assert.throws(() => validateElectricalMapLayout({
    version: 1,
    canvas: { width: 1_000, height: 700 },
    nodes: [
      { nodeId: 'grid', centerX: 300, centerY: 350 },
      { nodeId: 'grid', centerX: 500, centerY: 350 },
    ],
  }), /duplicated/);
  assert.throws(() => validateElectricalMapLayout({
    version: 1,
    canvas: { width: 1_000, height: 700 },
    nodes: [{ nodeId: 'grid', centerX: 1_001, centerY: 350 }],
  }), /inside the design canvas/);
  assert.throws(() => validateElectricalMapLayout({
    version: 1,
    canvas: { width: 1_000, height: 700 },
    nodes: [{ nodeId: 'grid', centerX: 300, centerY: 350 }],
  }, ['grid', 'board']), /exactly match/);
  assert.equal(validStoredElectricalMapLayout({ version: 2 }), undefined);
});

test('client electrical map IDs include only confirmed grid-reachable items', () => {
  const nodeIds = clientElectricalMapNodeIds({
    nodes: [
      { id: 'grid', kind: 'GRID' },
      { id: 'board', kind: 'BOARD' },
      { id: 'asset', kind: 'SITE_ASSET', coverageState: 'DIRECT' },
      { id: 'tbc-asset', kind: 'SITE_ASSET', coverageState: 'TBC' },
      { id: 'orphan-board', kind: 'BOARD' },
      { id: 'residual', kind: 'VIRTUAL_RESIDUAL', parentNodeId: 'board' },
    ],
    edges: [
      { sourceNodeId: 'grid', targetNodeId: 'board', relationship: 'FED_FROM' },
      { sourceNodeId: 'board', targetNodeId: 'asset', relationship: 'FED_FROM' },
      { sourceNodeId: 'board', targetNodeId: 'tbc-asset', relationship: 'FED_FROM' },
    ],
    unresolved: [
      { subjectType: 'SITE_ASSET', subjectId: 'tbc-asset' },
      { subjectType: 'BOARD', subjectId: 'orphan-board' },
    ],
  });
  assert.deepEqual([...nodeIds].sort(), ['asset', 'board', 'grid', 'residual']);
});
