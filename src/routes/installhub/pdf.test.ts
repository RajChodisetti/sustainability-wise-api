import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAuthoritativeCanonicalSnapshot,
  assertPinnedOrExplicitLive,
  assertPinnedSnapshotProvenance,
  liveDiagnosticCanonicalReport,
  installHubReportVariantKey,
  pinnedPhotoMatchesManifest,
  requestedLiveMode,
  requestedReportDetailMode,
  requestedRecordVersion,
} from './pdf.js';
import type { CanonicalInstallationTree } from './canonical.js';

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
    /^installation-pack:v3:by-zone:map:tree-revision-7:forms-[a-f0-9]{24}$/,
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
      meterPresent: false,
    }],
    siteAssets: [],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [{
      id: 'draft-form',
      installationId: 'installation-diagnostic',
      formType: 'honeywell-q400',
      schemaVersion: 2,
      status: 'Draft',
      answers: {},
      attachments: [],
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
  assert.ok(report.readinessIssues.some((issue) => issue.code === 'SUPPLY_TBC'));
  assert.ok(report.unresolvedRelationships.some((item) => (
    item.subjectId === 'board-tbc' && item.reason === 'TBC'
  )));
});
