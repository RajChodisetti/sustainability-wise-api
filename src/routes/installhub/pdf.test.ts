import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import {
  assertAuthoritativeCanonicalSnapshot,
  assertPinnedOrExplicitLive,
  assertPinnedSnapshotProvenance,
  buildElectricalMapDownloadArtifact,
  installHubChannelLoadLabel,
  installhubPdfRoutes,
  liveDiagnosticCanonicalReport,
  registerInstallHubElectricalMapDownloadRoute,
  installHubReportVariantKey,
  pinnedCanonicalReport,
  pinnedPhotoMatchesManifest,
  requestedElectricalMapDownloadFormat,
  requestedLiveMode,
  requestedReportDetailMode,
  requestedRecordVersion,
  type InstallHubElectricalMapDownloadDependencies,
} from './pdf.js';
import type { CanonicalInstallationTree } from './canonical.js';
import { buildCanonicalSnapshotPayload } from './treeService.js';

const electricalMapUrl = '/v1/installhub/installations/installation-1/electrical-map';

function bearer(input: {
  userId: string;
  app: 'ecoaudit' | 'installhub';
  role: 'admin' | 'inspector' | 'viewer';
}): { authorization: string } {
  return { authorization: `Bearer ${signAccessToken(input)}` };
}

async function withPdfRouteApp(
  run: (app: ReturnType<typeof Fastify>) => Promise<void>,
): Promise<void> {
  const app = Fastify();
  await app.register(installhubPdfRoutes, { prefix: '/v1/installhub' });
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function withElectricalMapRouteApp(
  dependencies: InstallHubElectricalMapDownloadDependencies,
  run: (app: ReturnType<typeof Fastify>) => Promise<void>,
): Promise<void> {
  const app = Fastify();
  await app.register(async (scoped) => {
    registerInstallHubElectricalMapDownloadRoute(scoped, dependencies);
  }, { prefix: '/v1/installhub' });
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function electricalMapRouteTree(input: {
  recordVersionNumber?: number;
  treeRevision?: number;
  siteName?: string;
} = {}): CanonicalInstallationTree {
  return {
    treeSchemaVersion: 2,
    installation: {
      id: 'installation-1',
      externalKey: 'external-1',
      siteCode: 'SITE',
      timezone: 'Australia/Sydney',
      clientName: 'Example Client',
      siteName: input.siteName ?? 'Example Site',
      siteAddress: '1 Example Street',
      inspectorName: 'Inspector',
      auditDate: '2026-09-07',
      status: 'Draft',
      treeSchemaVersion: 2,
      treeRevision: input.treeRevision ?? 11,
      recordVersionNumber: input.recordVersionNumber ?? 0,
    },
    gridSupplies: [{
      id: 'grid-1',
      installationId: 'installation-1',
      name: 'Grid',
      isDefault: true,
    }],
    zones: [],
    electricalAssets: [],
    siteAssets: [],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    serverDerived: { virtualMeterDefinitions: [] },
  };
}

test('pinned reports require exact registry identity and checksum', () => {
  const manifest = {
    id: '11111111-1111-4111-8111-111111111111',
    checksum: 'sha256:pinned',
  };
  assert.equal(pinnedPhotoMatchesManifest({
    id: manifest.id.toUpperCase(),
    checksum: manifest.checksum,
  }, manifest), true);
  assert.equal(pinnedPhotoMatchesManifest({
    id: manifest.id,
    checksum: 'sha256:mutated',
  }, manifest), false);
  assert.equal(pinnedPhotoMatchesManifest({
    id: '22222222-2222-4222-8222-222222222222',
    checksum: manifest.checksum,
  }, manifest), false);
});

test('authoritative reports require a version and live diagnostics are explicit', () => {
  assert.equal(requestedRecordVersion('7'), 7);
  assert.equal(requestedLiveMode('true'), true);
  assert.doesNotThrow(() => assertPinnedOrExplicitLive({
    recordVersionNumber: 7,
    liveMode: false,
  }));
  assert.doesNotThrow(() => assertPinnedOrExplicitLive({ liveMode: true }));
  assert.throws(() => assertPinnedOrExplicitLive({ liveMode: false }));
  assert.throws(() => assertPinnedOrExplicitLive({
    recordVersionNumber: 7,
    liveMode: true,
  }));
});

test('electrical-map downloads accept only PNG/SVG and positive record versions', () => {
  assert.equal(requestedElectricalMapDownloadFormat(undefined), 'png');
  assert.equal(requestedElectricalMapDownloadFormat('png'), 'png');
  assert.equal(requestedElectricalMapDownloadFormat('svg'), 'svg');
  assert.throws(() => requestedElectricalMapDownloadFormat('jpeg'));
  assert.throws(() => requestedRecordVersion('0'));
  assert.throws(() => requestedRecordVersion('-1'));
});

test('electrical-map SVG artifacts use bounded source-aware attachment names', async () => {
  const report = liveDiagnosticCanonicalReport(electricalMapRouteTree({
    treeRevision: 23,
    siteName: 'Map / Site',
  }));
  const artifact = await buildElectricalMapDownloadArtifact({
    report,
    siteName: 'Map / Site',
    format: 'svg',
  });
  assert.equal(artifact.contentType, 'image/svg+xml');
  assert.equal(artifact.filename, 'map-site-electrical-map-revision-23.svg');
  assert.match(artifact.body.toString('utf8'), /^<svg /);
  assert.match(artifact.body.toString('utf8'), /data-node-id="grid-1"/);
});

test('electrical-map download route enforces authentication, app, role, format and version boundaries', async () => {
  await withPdfRouteApp(async (app) => {
    const unauthenticated = await app.inject({ method: 'GET', url: electricalMapUrl });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const wrongApp = await app.inject({
      method: 'GET',
      url: electricalMapUrl,
      headers: bearer({ userId: 'eco-admin', app: 'ecoaudit', role: 'admin' }),
    });
    assert.equal(wrongApp.statusCode, 403, wrongApp.body);

    const viewer = await app.inject({
      method: 'GET',
      url: electricalMapUrl,
      headers: bearer({ userId: 'field-viewer', app: 'installhub', role: 'viewer' }),
    });
    assert.equal(viewer.statusCode, 403, viewer.body);

    const adminHeaders = bearer({ userId: 'field-admin', app: 'installhub', role: 'admin' });
    const invalidFormat = await app.inject({
      method: 'GET',
      url: `${electricalMapUrl}?format=jpeg`,
      headers: adminHeaders,
    });
    assert.equal(invalidFormat.statusCode, 400, invalidFormat.body);

    const invalidVersion = await app.inject({
      method: 'GET',
      url: `${electricalMapUrl}?recordVersionNumber=0`,
      headers: adminHeaders,
    });
    assert.equal(invalidVersion.statusCode, 400, invalidVersion.body);
  });
});

test('electrical-map route authorizes an assigned inspector and serves the live partial map', async () => {
  const liveTree = electricalMapRouteTree({ treeRevision: 19, siteName: 'Live Site' });
  let currentTreeLoads = 0;
  let artifactInput: Parameters<InstallHubElectricalMapDownloadDependencies['buildArtifact']>[0]
    | undefined;
  const installation = {
    createdByUserId: 'field-owner',
    assignedInspectorUserId: 'field-assignee',
  } as Awaited<ReturnType<InstallHubElectricalMapDownloadDependencies['loadInstallation']>>;
  const dependencies: InstallHubElectricalMapDownloadDependencies = {
    loadInstallation: async () => installation,
    loadCurrentTree: async () => {
      currentTreeLoads += 1;
      return liveTree;
    },
    loadRecordVersion: async () => null,
    buildArtifact: async (input) => {
      artifactInput = input;
      return {
        body: Buffer.from('live-map'),
        contentType: 'image/png',
        filename: 'live-site-electrical-map-revision-19.png',
      };
    },
  };

  await withElectricalMapRouteApp(dependencies, async (app) => {
    const denied = await app.inject({
      method: 'GET',
      url: electricalMapUrl,
      headers: bearer({ userId: 'other-inspector', app: 'installhub', role: 'inspector' }),
    });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(currentTreeLoads, 0);

    const response = await app.inject({
      method: 'GET',
      url: electricalMapUrl,
      headers: bearer({ userId: 'field-assignee', app: 'installhub', role: 'inspector' }),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.rawPayload.toString('utf8'), 'live-map');
    assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(
      response.headers['content-disposition'],
      'attachment; filename="live-site-electrical-map-revision-19.png"',
    );
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-installhub-map-source'], 'diagnostic-live');
    assert.equal(response.headers['x-installhub-tree-revision'], '19');
    assert.equal(response.headers['x-installhub-record-version'], undefined);
    assert.equal(currentTreeLoads, 1);
    assert.equal(artifactInput?.format, 'png');
    assert.equal(artifactInput?.siteName, 'Live Site');
    assert.equal(artifactInput?.report.reportSource, 'diagnostic-live');
    assert.equal(artifactInput?.report.authoritative, false);
  });
});

test('electrical-map route loads the exact requested version without requiring current readiness', async () => {
  const pinnedTree = electricalMapRouteTree({
    recordVersionNumber: 7,
    treeRevision: 17,
    siteName: 'Pinned Site',
  });
  const snapshot = buildCanonicalSnapshotPayload({ tree: pinnedTree, mediaManifest: [] });
  const recordVersionLoads: Array<{ installationId: string; versionNumber?: number }> = [];
  let currentTreeLoads = 0;
  let artifactInput: Parameters<InstallHubElectricalMapDownloadDependencies['buildArtifact']>[0]
    | undefined;
  const installation = {
    createdByUserId: 'field-owner',
    assignedInspectorUserId: null,
  } as Awaited<ReturnType<InstallHubElectricalMapDownloadDependencies['loadInstallation']>>;
  const dependencies: InstallHubElectricalMapDownloadDependencies = {
    loadInstallation: async () => installation,
    loadCurrentTree: async () => {
      currentTreeLoads += 1;
      return electricalMapRouteTree();
    },
    loadRecordVersion: async (input) => {
      recordVersionLoads.push({
        installationId: input.installationId,
        versionNumber: input.versionNumber,
      });
      return input.versionNumber === 7
        ? { versionNumber: 7, createdAt: '2026-09-07T00:00:00.000Z', snapshot }
        : null;
    },
    buildArtifact: async (input) => {
      artifactInput = input;
      return {
        body: Buffer.from('<svg id="pinned-map"/>'),
        contentType: 'image/svg+xml',
        filename: 'pinned-site-electrical-map-version-7.svg',
      };
    },
  };

  await withElectricalMapRouteApp(dependencies, async (app) => {
    const response = await app.inject({
      method: 'GET',
      url: `${electricalMapUrl}?format=svg&recordVersionNumber=7`,
      headers: bearer({ userId: 'field-owner', app: 'installhub', role: 'inspector' }),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.rawPayload.toString('utf8'), '<svg id="pinned-map"/>');
    assert.equal(response.headers['content-type'], 'image/svg+xml');
    assert.equal(response.headers['x-installhub-map-source'], 'canonical-version');
    assert.equal(response.headers['x-installhub-tree-revision'], '17');
    assert.equal(response.headers['x-installhub-record-version'], '7');
    assert.equal(currentTreeLoads, 0);
    assert.deepEqual(recordVersionLoads, [{
      installationId: 'installation-1',
      versionNumber: 7,
    }]);
    assert.equal(artifactInput?.format, 'svg');
    assert.equal(artifactInput?.siteName, 'Pinned Site');
    assert.equal(artifactInput?.report.reportSource, 'canonical-version');
    assert.equal(artifactInput?.report.recordVersionNumber, 7);

    const missing = await app.inject({
      method: 'GET',
      url: `${electricalMapUrl}?recordVersionNumber=8`,
      headers: bearer({ userId: 'field-owner', app: 'installhub', role: 'inspector' }),
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(currentTreeLoads, 0);
  });
});

test('installation-pack detail mode and durable variant normalize deterministically', () => {
  assert.equal(requestedReportDetailMode(undefined), 'by-electrical-hierarchy');
  assert.equal(requestedReportDetailMode('by-zone'), 'by-zone');
  assert.throws(() => requestedReportDetailMode('other'));
  const normalized = installHubReportVariantKey({
    detailMode: 'by-zone',
    formIds: ['form-b', 'form-a', 'form-a'],
    sourceKey: 'tree-revision-7',
  });
  assert.equal(normalized, installHubReportVariantKey({
    detailMode: 'by-zone',
    formIds: ['form-a', 'form-b'],
    sourceKey: 'tree-revision-7',
  }));
  assert.match(
    normalized,
    /^installation-pack:v10:by-zone:map:tree-revision-7:forms-[a-f0-9]{24}$/,
  );
  assert.notEqual(
    installHubReportVariantKey({
      detailMode: 'by-zone',
      formIds: ['form-a'],
      sourceKey: 'tree-revision-7',
    }),
    installHubReportVariantKey({
      detailMode: 'by-zone',
      formIds: ['form-a'],
      sourceKey: 'tree-revision-8',
    }),
  );
  assert.ok(installHubReportVariantKey({
    detailMode: 'by-zone',
    formIds: Array.from({ length: 1_000 }, (_, index) => `form-${index}`),
    sourceKey: 'tree-revision-7',
  }).length < 100);
});

test('PDF channel load labels are explicit for classified, custom, main and spare channels', () => {
  assert.equal(installHubChannelLoadLabel({
    purpose: 'SUB_CIRCUIT',
    loadTypeCode: 'HVAC',
  }), 'AC / HVAC');
  assert.equal(installHubChannelLoadLabel({
    purpose: 'SUB_CIRCUIT',
    loadTypeCode: 'OTHER',
    customLoadTypeName: 'Process line 4',
  }), 'Process line 4');
  assert.equal(installHubChannelLoadLabel({
    purpose: 'MAIN_SUPPLY',
  }), 'Main supply');
  assert.equal(installHubChannelLoadLabel({
    purpose: 'SPARE',
    loadTypeCode: 'HVAC',
  }), 'Spare / not used');
});

test('draft pinned versions are refused while an eligible historical version remains authoritative after reopen', () => {
  const eligible = {
    payloadHash: 'payload-hash-7',
    readiness: {
      eligibility: { authoritativeReport: true },
    },
  } as Parameters<typeof assertAuthoritativeCanonicalSnapshot>[0] & { payloadHash: string };
  const draft = {
    payloadHash: 'payload-hash-8',
    readiness: {
      eligibility: { authoritativeReport: false },
    },
  } as Parameters<typeof assertAuthoritativeCanonicalSnapshot>[0] & { payloadHash: string };

  assert.doesNotThrow(() => assertAuthoritativeCanonicalSnapshot(eligible));
  assert.doesNotThrow(() => assertPinnedSnapshotProvenance({
    snapshot: eligible,
    expectedPayloadHash: 'payload-hash-7',
  }));
  assert.throws(() => assertAuthoritativeCanonicalSnapshot(draft));
  assert.throws(() => assertPinnedSnapshotProvenance({
    snapshot: eligible,
    expectedPayloadHash: 'stale-hash',
  }), /canonical_report_snapshot_provenance_mismatch/);
});

test('live diagnostics project the current Draft/TBC tree without claiming a pinned version or hash', () => {
  const tree: CanonicalInstallationTree = {
    treeSchemaVersion: 2,
    installation: {
      id: 'installation-diagnostic',
      externalKey: 'external-diagnostic',
      siteCode: 'DIAG',
      timezone: 'Australia/Sydney',
      clientName: 'Diagnostic Client',
      siteName: 'Diagnostic Site',
      siteAddress: '1 Diagnostic Street',
      inspectorName: 'Inspector',
      auditDate: '2026-08-01',
      status: 'Draft',
      treeSchemaVersion: 2,
      treeRevision: 13,
      recordVersionNumber: 0,
      completionNotes: 'Technician verified final labelling and handover.',
      electricalMapLayout: {
        version: 1,
        canvas: { width: 1_000, height: 700 },
        nodes: [
          { nodeId: 'board-tbc', centerX: 700, centerY: 350 },
          { nodeId: 'grid-1', centerX: 300, centerY: 350 },
        ],
      },
      electricalMapLayoutRevision: 2,
    },
    gridSupplies: [{
      id: 'grid-1',
      installationId: 'installation-diagnostic',
      name: 'Grid',
      isDefault: true,
    }],
    zones: [{
      id: 'zone-1',
      installationId: 'installation-diagnostic',
      zoneCode: 'PLANT-ROOM',
      zoneName: 'Plant room',
      zoneDescription: '',
      photos: [],
    }],
    electricalAssets: [{
      id: 'board-tbc',
      installationId: 'installation-diagnostic',
      zoneId: 'zone-1',
      assetName: 'Unresolved board',
      typeCode: 'MSB',
      displayCode: {
        value: 'DIAG-MSB-001',
        generatedValue: 'DIAG-MSB-001',
        isOverridden: false,
        ruleVersion: 1,
      },
      electricalSource: { kind: 'TBC' },
      extraPhotos: [],
      meterPresent: true,
    }],
    siteAssets: [{
      id: 'asset-1',
      installationId: 'installation-diagnostic',
      zoneId: 'zone-1',
      assetName: 'Workshop HVAC',
      typeCode: 'HVAC',
      displayCode: {
        value: 'DIAG-HVAC-001',
        generatedValue: 'DIAG-HVAC-001',
        isOverridden: false,
        ruleVersion: 1,
      },
      electricalSource: { kind: 'BOARD', boardId: 'board-tbc' },
      meteringState: { kind: 'METERED', measurementAssignmentIds: ['assignment-1'] },
      meterPresent: true,
      extraPhotos: [],
    }],
    meterDevices: [{
      id: 'meter-1',
      installationId: 'installation-diagnostic',
      installedOnBoardId: 'board-tbc',
      customName: 'Plant meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      deviceNumber: 'DEVICE-1',
      serialNumber: 'SERIAL-1',
      displayName: {
        value: 'DIAG-A3RM-001',
        generatedValue: 'DIAG-A3RM-001',
        isOverridden: false,
        ruleVersion: 1,
      },
      channels: [{
        id: 'channel-1',
        ordinal: 1,
        phaseLabel: 'L1',
        purpose: 'SUB_CIRCUIT',
        loadTypeCode: 'HVAC',
        sensorRating: '60A',
        description: 'Workshop mechanical load',
      }],
      wwPhotos: {},
    }],
    measurementAssignments: [{
      id: 'assignment-1',
      installationId: 'installation-diagnostic',
      meterId: 'meter-1',
      channelIds: ['channel-1'],
      phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
      direction: 'CONSUMPTION',
      status: 'CONFIRMED',
    }],
    formSubmissions: [{
      id: 'draft-form',
      installationId: 'installation-diagnostic',
      formType: 'honeywell-q400',
      schemaVersion: 2,
      status: 'Draft',
      answers: {},
      attachments: [],
      historicalMeterRemoved: false,
    }],
    serverDerived: { virtualMeterDefinitions: [] },
  };

  const report = liveDiagnosticCanonicalReport(tree);
  assert.equal(report.reportSource, 'diagnostic-live');
  assert.equal(report.authoritative, false);
  assert.equal(report.treeRevision, 13);
  assert.equal(report.recordVersionNumber, null);
  assert.equal(report.snapshotPayloadHash, null);
  assert.equal(report.mappingContentHash, null);
  assert.equal(report.readyToComplete, false);
  assert.equal(
    report.completionNotes,
    'Technician verified final labelling and handover.',
  );
  assert.deepEqual(report.electricalMapLayout, tree.installation.electricalMapLayout);
  assert.deepEqual(report.meters[0]?.channels[0], {
    id: 'channel-1',
    ordinal: 1,
    purpose: 'SUB_CIRCUIT',
    load: 'AC / HVAC',
    phaseLabel: 'L1',
    sensorRating: '60A',
    description: 'Workshop mechanical load',
  });
  assert.deepEqual(report.meteringRows[0], {
    assignmentId: 'assignment-1',
    meterId: 'meter-1',
    channelId: 'channel-1',
    meterDisplayName: 'DIAG-A3RM-001',
    channelOrdinal: 1,
    channelPurpose: 'SUB_CIRCUIT',
    channelDescription: 'Workshop mechanical load',
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  });
  assert.ok(report.readinessIssues.some((issue) => issue.code === 'SUPPLY_TBC'));
  assert.ok(report.unresolvedRelationships.some((item) => (
    item.subjectId === 'board-tbc' && item.reason === 'TBC'
  )));

  const pinned = pinnedCanonicalReport(buildCanonicalSnapshotPayload({
    tree,
    mediaManifest: [],
  }));
  assert.equal(pinned.reportSource, 'canonical-version');
  assert.equal(
    pinned.completionNotes,
    'Technician verified final labelling and handover.',
  );
});
