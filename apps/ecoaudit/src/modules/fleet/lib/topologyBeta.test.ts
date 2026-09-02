import assert from 'node:assert/strict';
import test from 'node:test';
import type { TopologyBetaDocument } from '@/modules/fleet/types/domain';
import {
  businessSiteMatchesQuery,
  businessSiteSearchLabel,
  buildTopologyForest,
  parseTopologyDeviceIds,
  topologySiteLabel,
} from '@/modules/fleet/lib/topologyBeta';

const document: TopologyBetaDocument = {
  schemaVersion: 1,
  surface: 'BETA_REVIEW_ONLY',
  location: { locationId: 'essendon', name: 'Essendon', clientCode: 'subaru', rootMeterId: 'grid' },
  decision: 'COLLECT_MORE',
  publicationStatus: 'WITHHELD_LOW_CONFIDENCE',
  publicHierarchyAvailable: false,
  continueCollecting: true,
  nodes: [
    { meterId: 'load', deviceId: 'D3', label: 'Load', state: 'REVIEW' },
    { meterId: 'grid', deviceId: 'D1', label: 'Grid', state: 'CONFIDENT' },
    { meterId: 'panel', deviceId: 'D2', label: 'Panel', state: 'REVIEW' },
    { meterId: 'waiting', deviceId: 'D4', label: 'Waiting', state: 'WAITING' },
  ],
  edges: [
    { parent: 'grid', child: 'panel', state: 'CONFIDENT', confidenceLabel: 'Confident relation' },
    { parent: 'panel', child: 'load', state: 'REVIEW', confidenceLabel: 'Needs review' },
  ],
  unresolvedMeterIds: ['waiting'],
  unknownRequestedMeters: [],
  summary: {
    selectedMeterCount: 4,
    confidentRelationCount: 1,
    reviewRelationCount: 1,
    unresolvedMeterCount: 1,
    withheldCandidateCount: 0,
  },
  thresholds: {
    minimumTopKInclusion: 0.9,
    minimumBootstrapStability: 0.9,
    minimumLowTopKInclusion: 0.55,
    minimumLowBootstrapStability: 0.5,
    minimumLowOverlapSamples: 288,
  },
  disclaimer: 'Observed meters only.',
};

test('topology beta normalizes and deduplicates pasted device IDs', () => {
    assert.deepEqual(parseTopologyDeviceIds(' ddf1\nDDF2,ddf1 ; dd437 '), [
      'DDF1',
      'DDF2',
      'DD437',
    ]);
});

test('topology beta builds a deterministic tree and retains unresolved roots', () => {
    const forest = buildTopologyForest(document);
    assert.deepEqual(forest.map((item) => item.node.meterId), ['grid', 'waiting']);
    assert.equal(forest[0]?.children[0]?.node.meterId, 'panel');
    assert.equal(forest[0]?.children[0]?.children[0]?.node.meterId, 'load');
    assert.equal(forest[0]?.children[0]?.incomingEdge?.state, 'CONFIDENT');
});

test('topology beta labels registered sites for the searchable input', () => {
    assert.equal(topologySiteLabel({
      locationId: 'essendon',
      name: 'Essendon',
      clientCode: 'subaru',
      mappingRevision: 1,
      meterCount: 5,
      latestDecision: 'COLLECT_MORE',
    }), 'Essendon — subaru · 5 meters');
});

test('business site search matches partial site, client, address and postcode text', () => {
  const site = {
    id: 'site-1',
    name: 'Subaru Essendon Fields',
    address: '1 Wirraway Road, Essendon Fields VIC 3041',
    locality: 'Essendon Fields',
    state: 'VIC',
    postcode: '3041',
    clientId: 'client-1',
    clientName: 'Inchcape Australia',
  };
  assert.equal(businessSiteSearchLabel(site), 'Subaru Essendon Fields — Inchcape Australia');
  assert.equal(businessSiteMatchesQuery(site, 'essen'), true);
  assert.equal(businessSiteMatchesQuery(site, 'INCH'), true);
  assert.equal(businessSiteMatchesQuery(site, 'wirraway'), true);
  assert.equal(businessSiteMatchesQuery(site, '304'), true);
  assert.equal(businessSiteMatchesQuery(site, 'altona'), false);
});
