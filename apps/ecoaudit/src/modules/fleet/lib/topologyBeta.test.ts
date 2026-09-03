import assert from 'node:assert/strict';
import test from 'node:test';
import type { TopologyBetaDocument } from '@/modules/fleet/types/domain';
import {
  businessSiteMatchesQuery,
  businessSiteSearchLabel,
  buildTopologyForest,
  buildTopologyPresentation,
  isReviewedTopologyEdge,
  parseTopologyDeviceIds,
  topologyDecisionLabel,
  topologyNodeRoleDisplay,
  topologySiteLabel,
} from '@/modules/fleet/lib/topologyBeta';

const document: TopologyBetaDocument = {
  schemaVersion: 1,
  surface: 'BETA_REVIEW_ONLY',
  location: { locationId: 'essendon', name: 'Essendon', clientCode: 'subaru', rootMeterId: 'grid' },
  decision: 'STABLE_CANDIDATE',
  publicationStatus: 'WITHHELD_LOW_CONFIDENCE',
  publicHierarchyAvailable: false,
  continueCollecting: true,
  nodes: [
    { meterId: 'load', deviceId: 'D3', label: 'Load', state: 'REVIEW', telemetryStatus: 'ONLINE', telemetryEvidenceValid: true, sampleCount: 4_032, validSampleCount: 4_032, validFraction: 1 },
    { meterId: 'grid', deviceId: 'D1', label: 'Grid', state: 'CONFIDENT', telemetryStatus: 'ONLINE', telemetryEvidenceValid: true, sampleCount: 4_032, validSampleCount: 4_032, validFraction: 1 },
    { meterId: 'panel', deviceId: 'D2', label: 'Panel', state: 'REVIEW', telemetryStatus: 'ONLINE', telemetryEvidenceValid: true, sampleCount: 4_032, validSampleCount: 4_032, validFraction: 1 },
  ],
  edges: [
    {
      parent: 'grid',
      child: 'panel',
      state: 'CONFIDENT',
      confidenceLabel: 'Strong telemetry support',
      overlapSampleCount: 1_000,
      topKInclusionWeight: 0.97,
      bootstrapStability: 0.94,
    },
    {
      parent: 'panel',
      child: 'load',
      state: 'REVIEW',
      confidenceLabel: 'Needs review',
      overlapSampleCount: 900,
      topKInclusionWeight: 0.75,
      bootstrapStability: 0.62,
    },
  ],
  unresolvedMeterIds: [],
  unknownRequestedMeters: [],
  evidence: {
    assessmentReasons: [],
    bootstrap: {
      requestedReplicates: 20,
      successfulReplicates: 20,
      failedReplicates: 0,
      observationCount: 4_032,
      windowSize: 2_016,
      successFraction: 1,
    },
    sourceWindow: {
      fromTs: 0,
      toTs: 14 * 86_400,
      intervalSeconds: 300,
    },
    sourceWindowEvidenceDays: 14,
    sourceWindowMaximumSampleCount: 4_032,
    telemetryCandidateBlockReasons: [],
    consecutiveStableRuns: 3,
    stableRunsRequired: 3,
    stabilityEvidenceToTs: 14 * 86_400,
    stabilityMetadataValid: true,
  },
  summary: {
    selectedMeterCount: 3,
    confidentRelationCount: 1,
    reviewRelationCount: 1,
    unresolvedMeterCount: 0,
    withheldCandidateCount: 0,
  },
  thresholds: {
    minimumTopKInclusion: 0.9,
    minimumBootstrapStability: 0.9,
    minimumHighOverlapSamples: 576,
    minimumHighValidFraction: 0.65,
    minimumHighValidSampleCount: 1_311,
    minimumEvidenceDays: 7,
    minimumLowTopKInclusion: 0.55,
    minimumLowBootstrapStability: 0.5,
    minimumLowOverlapSamples: 288,
    minimumBootstrapSuccessFraction: 0.8,
    stableRunsRequired: 3,
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

test('topology beta builds a deterministic complete tree', () => {
  const presentation = buildTopologyPresentation(document);
  assert.deepEqual(presentation.forest.map((item) => item.node.meterId), ['grid']);
  assert.equal(presentation.forest[0]?.children[0]?.node.meterId, 'panel');
  assert.equal(presentation.forest[0]?.children[0]?.children[0]?.node.meterId, 'load');
  assert.equal(presentation.forest[0]?.children[0]?.incomingEdge?.state, 'CONFIDENT');
  assert.deepEqual(presentation.unplacedNodes, []);
  assert.deepEqual(buildTopologyForest(document), presentation.forest);
});

test('topology beta keeps supported branches when another endpoint is unavailable', () => {
  for (const telemetryStatus of ['OFFLINE', 'TELEMETRY_OFFLINE']) {
    const unsafeDocument: TopologyBetaDocument = {
      ...document,
      unresolvedMeterIds: [],
      nodes: document.nodes.map((node) => (
        node.meterId === 'load'
          ? { ...node, telemetryStatus, sampleCount: 0, validSampleCount: 0, validFraction: 0 }
          : node
      )),
    };

    const presentation = buildTopologyPresentation(unsafeDocument);
    assert.deepEqual(
      presentation.displayedEdges.map((edge) => `${edge.parent}->${edge.child}`),
      ['grid->panel'],
    );
    assert.deepEqual(
      presentation.unplacedNodes.map((node) => node.meterId),
      ['load'],
    );
    assert.equal(presentation.suppressedEdgeCount, 1);
  }
});

test('topology beta rejects an edge whose overlap exceeds either endpoint sample count', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    unresolvedMeterIds: [],
    nodes: document.nodes
      .filter((node) => ['grid', 'panel'].includes(node.meterId))
      .map((node) => ({
        ...node,
        sampleCount: node.meterId === 'grid' ? 1_000 : 999,
        validSampleCount: node.meterId === 'grid' ? 1_000 : 999,
        validFraction: 1,
      })),
    edges: [{ ...document.edges[0]!, overlapSampleCount: 1_000 }],
  });

  assert.deepEqual(presentation.displayedEdges, []);
  assert.equal(presentation.suppressedEdgeCount, 1);
});

test('topology beta keeps reviewed site evidence separate from telemetry diagnostics', () => {
  const edge = {
    ...document.edges[0]!,
    provenance: 'REVIEWED_SITE_EVIDENCE',
    overlapSampleCount: 1_001,
  };
  const presentation = buildTopologyPresentation({
    ...document,
    evidence: undefined,
    unresolvedMeterIds: [],
    nodes: document.nodes.filter((node) => ['grid', 'panel'].includes(node.meterId)),
    edges: [edge],
  });

  assert.deepEqual(presentation.displayedEdges, [edge]);
});

test('topology beta fails closed on malformed reviewed relationships', () => {
  const reviewed = (parent: string, child: string) => ({
    parent,
    child,
    state: 'CONFIDENT' as const,
    confidenceLabel: 'Reviewed site relation',
    provenance: 'REVIEWED_SITE_EVIDENCE',
  });
  for (const edges of [
    [reviewed('grid', 'grid')],
    [reviewed('grid', 'load'), reviewed('panel', 'load')],
    [reviewed('grid', 'panel'), reviewed('panel', 'grid')],
  ]) {
    const presentation = buildTopologyPresentation({
      ...document,
      evidence: undefined,
      edges,
    });
    assert.deepEqual(presentation.displayedEdges, []);
  }
});

test('topology beta independently downgrades a false green payload', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    unresolvedMeterIds: [],
    nodes: document.nodes
      .filter((node) => ['grid', 'panel'].includes(node.meterId))
      .map((node) => ({ ...node, telemetryStatus: 'ONLINE' })),
    edges: [{
      ...document.edges[0]!,
      state: 'CONFIDENT',
      topKInclusionWeight: 0.89,
      bootstrapStability: 0.89,
    }],
  });

  assert.equal(presentation.displayedEdges[0]?.state, 'REVIEW');
  assert.match(presentation.displayedEdges[0]?.confidenceLabel ?? '', /needs review/u);
});

test('topology beta independently distinguishes high and low confidence branches while collecting', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    decision: 'COLLECT_MORE',
    evidence: {
      ...document.evidence!,
      consecutiveStableRuns: 2,
    },
  });

  assert.equal(presentation.displayedEdges[0]?.state, 'CONFIDENT');
  assert.equal(presentation.displayedEdges[1]?.state, 'REVIEW');
});

test('topology beta fails closed when an unsupported payload omits verifiable run evidence', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    schemaVersion: 2,
    evidence: undefined,
  });

  assert.deepEqual(presentation.displayedEdges, []);
  assert.deepEqual(presentation.forest, []);
  assert.deepEqual(
    presentation.unplacedNodes.map((node) => node.meterId),
    ['grid', 'load', 'panel'],
  );
});

test('topology beta fails closed on malformed or insufficient bootstrap evidence', () => {
  const baseBootstrap = document.evidence!.bootstrap!;
  for (const bootstrap of [
    { ...baseBootstrap, failedReplicates: 1 },
    { ...baseBootstrap, windowSize: 287 },
    { ...baseBootstrap, successFraction: 0.95 },
  ]) {
    const presentation = buildTopologyPresentation({
      ...document,
      evidence: { ...document.evidence!, bootstrap },
    });
    assert.deepEqual(presentation.displayedEdges, []);
  }
});

test('topology beta fails closed on explicit run blockers or durable job failure', () => {
  for (const unsafeDocument of [
    {
      ...document,
      evidence: {
        ...document.evidence!,
        telemetryCandidateBlockReasons: ['INCOMPLETE_HISTORICAL_SCAN'],
      },
    },
    {
      ...document,
      reconstruction: {
        locationId: 'essendon',
        state: 'RUNNING',
        job: { lastErrorCode: 'FETCH_INCOMPLETE', consecutiveFailures: 1 },
      },
    },
  ]) {
    assert.deepEqual(buildTopologyPresentation(unsafeDocument).displayedEdges, []);
  }
});

test('topology beta keeps the last successful beta candidates during a harmless duplicate-start conflict', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    evidence: undefined,
    nodes: document.nodes.map((node) => ({
      ...node,
      sampleCount: undefined,
      telemetryEvidenceValid: undefined,
    })),
    reconstruction: {
      locationId: 'essendon',
      state: 'WAITING_RETRY',
      job: { lastErrorCode: 'IDEMPOTENCYCONFLICTERROR', consecutiveFailures: 2 },
    },
  });

  assert.deepEqual(
    presentation.displayedEdges.map((edge) => edge.state),
    ['CONFIDENT', 'REVIEW'],
  );
});

test('topology beta fails closed on incoherent endpoint or source-window evidence', () => {
  const incoherentNodeDocument: TopologyBetaDocument = {
    ...document,
    nodes: document.nodes.map((node) => (
      node.meterId === 'panel'
        ? { ...node, telemetryEvidenceValid: false, validSampleCount: 4_031, validFraction: 1 }
        : node
    )),
  };
  const incoherentWindowDocument: TopologyBetaDocument = {
    ...document,
    evidence: { ...document.evidence!, sourceWindowMaximumSampleCount: 4_031 },
  };

  assert.deepEqual(buildTopologyPresentation(incoherentNodeDocument).displayedEdges, []);
  assert.deepEqual(buildTopologyPresentation(incoherentWindowDocument).displayedEdges, []);
});

test('topology beta downgrades green when the evidence horizon is too short', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    nodes: document.nodes
      .filter((node) => ['grid', 'panel'].includes(node.meterId))
      .map((node) => ({ ...node, sampleCount: 576, validSampleCount: 576 })),
    edges: [{ ...document.edges[0]!, overlapSampleCount: 576 }],
    evidence: {
      ...document.evidence!,
      bootstrap: {
        requestedReplicates: 20,
        successfulReplicates: 20,
        failedReplicates: 0,
        observationCount: 576,
        windowSize: 288,
        successFraction: 1,
      },
      sourceWindow: { fromTs: 0, toTs: 2 * 86_400, intervalSeconds: 300 },
      sourceWindowEvidenceDays: 2,
      sourceWindowMaximumSampleCount: 576,
      stabilityEvidenceToTs: 2 * 86_400,
    },
  });

  assert.equal(presentation.displayedEdges[0]?.state, 'REVIEW');
});

test('topology beta displays a safe partial telemetry forest', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    edges: [document.edges[0]!],
  });

  assert.deepEqual(
    presentation.displayedEdges.map((edge) => `${edge.parent}->${edge.child}`),
    ['grid->panel'],
  );
  assert.equal(presentation.forest[0]?.node.meterId, 'grid');
  assert.equal(presentation.forest[0]?.children[0]?.node.meterId, 'panel');
  assert.deepEqual(
    presentation.unplacedNodes.map((node) => node.meterId),
    ['load'],
  );
});

test('topology beta keeps explicitly unresolved meters out of the relationship tree', () => {
  const unresolvedNode = {
    meterId: 'waiting',
    deviceId: 'D4',
    label: 'Waiting',
    state: 'REVIEW' as const,
    telemetryStatus: 'ONLINE',
    telemetryEvidenceValid: true,
    sampleCount: 4_032,
    validSampleCount: 4_032,
    validFraction: 1,
  };
  const presentation = buildTopologyPresentation({
    ...document,
    nodes: [document.nodes.find((node) => node.meterId === 'grid')!, unresolvedNode],
    edges: [{
      parent: 'grid',
      child: 'waiting',
      state: 'CONFIDENT',
      confidenceLabel: 'Strong telemetry support',
      overlapSampleCount: 1_000,
      topKInclusionWeight: 0.97,
      bootstrapStability: 0.94,
    }],
    unresolvedMeterIds: ['waiting'],
  });

  assert.deepEqual(presentation.displayedEdges, []);
  assert.deepEqual(presentation.forest, []);
  assert.deepEqual(
    presentation.unplacedNodes.map((node) => node.meterId),
    ['grid', 'waiting'],
  );
});

test('topology beta fails closed when an unreviewed endpoint omits its valid sample count', () => {
  const presentation = buildTopologyPresentation({
    ...document,
    unresolvedMeterIds: [],
    nodes: document.nodes.map((node) => (
      node.meterId === 'panel' ? { ...node, validSampleCount: undefined } : node
    )),
  });

  assert.deepEqual(presentation.displayedEdges, []);
  assert.deepEqual(presentation.forest, []);
  assert.deepEqual(
    presentation.unplacedNodes.map((node) => node.meterId),
    ['grid', 'load', 'panel'],
  );
});

test('topology beta shows qualified candidates while telemetry is pending and filters below-floor edges', () => {
  const waitingPresentation = buildTopologyPresentation({
    ...document,
    decision: 'WAITING_TELEMETRY',
  });
  assert.deepEqual(
    waitingPresentation.displayedEdges.map((edge) => edge.state),
    ['CONFIDENT', 'REVIEW'],
  );
  assert.deepEqual(waitingPresentation.unplacedNodes, []);

  const lowOverlapPresentation = buildTopologyPresentation({
    ...document,
    unresolvedMeterIds: [],
    thresholds: {
      ...document.thresholds,
      minimumLowOverlapSamples: 1,
    },
    edges: document.edges.map((edge, index) => (
      index === 0 ? { ...edge, overlapSampleCount: 287 } : edge
    )),
  });
  assert.deepEqual(
    lowOverlapPresentation.displayedEdges.map((edge) => `${edge.parent}->${edge.child}`),
    ['panel->load'],
  );
  assert.equal(lowOverlapPresentation.suppressedEdgeCount, 1);
});

test('topology beta requires finite Top-K and bootstrap metrics at the low-confidence floors', () => {
  const edge = document.edges[0]!;
  for (const unsafeEdge of [
    { ...edge, topKInclusionWeight: 0.54 },
    { ...edge, bootstrapStability: 0.49 },
    { ...edge, topKInclusionWeight: undefined },
    { ...edge, bootstrapStability: Number.NaN },
  ]) {
    const presentation = buildTopologyPresentation({
      ...document,
      nodes: document.nodes.filter((node) => ['grid', 'panel'].includes(node.meterId)),
      edges: [unsafeEdge],
      unresolvedMeterIds: [],
    });
    assert.deepEqual(presentation.displayedEdges, []);
    assert.deepEqual(presentation.forest, []);
    assert.deepEqual(
      presentation.unplacedNodes.map((node) => node.meterId),
      ['grid', 'panel'],
    );
  }
});

test('topology beta preserves explicit reviewed site evidence during a telemetry outage', () => {
  const reviewedEdge = {
    parent: 'grid',
    child: 'load',
    state: 'CONFIDENT' as const,
    confidenceLabel: 'Reviewed site relation',
    provenance: 'REVIEWED_SITE_EVIDENCE',
  };
  const reviewedPresentation = buildTopologyPresentation({
    ...document,
    decision: 'WAITING_TELEMETRY',
    nodes: document.nodes.map((node) => (
      node.meterId === 'load'
        ? {
            ...node,
            telemetryStatus: 'TELEMETRY_OFFLINE',
            sampleCount: 0,
            validSampleCount: 0,
            validFraction: 0,
          }
        : node
    )),
    edges: [reviewedEdge],
    unresolvedMeterIds: [],
  });

  assert.equal(isReviewedTopologyEdge(reviewedEdge), true);
  assert.deepEqual(reviewedPresentation.displayedEdges, [reviewedEdge]);
  assert.equal(reviewedPresentation.forest[0]?.children[0]?.node.meterId, 'load');
});

test('topology beta labels heuristic roles as suggestions without breaking older payloads', () => {
  assert.deepEqual(topologyNodeRoleDisplay({
    meterId: 'load',
    deviceId: 'D3',
    label: 'HVAC',
    role: 'load',
    suggestedRole: 'load',
    roleSource: 'LABEL_HEURISTIC_REVIEW_REQUIRED',
    state: 'WAITING',
  }), { label: 'Suggested role', value: 'load' });
  assert.deepEqual(topologyNodeRoleDisplay({
    meterId: 'grid',
    deviceId: 'D1',
    label: 'Grid',
    role: 'grid-root',
    state: 'CONFIDENT',
  }), { label: 'Role', value: 'grid-root' });
});

test('topology beta presents telemetry-waiting decisions as relationship evidence state', () => {
  assert.equal(
    topologyDecisionLabel('AdaptiveDecision.WAITING_TELEMETRY'),
    'Waiting for relationship evidence',
  );
  assert.equal(topologyDecisionLabel('STABLE_CANDIDATE'), 'Stable candidate');
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
