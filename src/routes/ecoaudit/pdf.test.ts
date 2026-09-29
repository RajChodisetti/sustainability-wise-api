import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildEcoAuditChunkHtml,
  buildEcoAuditReportOverview,
  buildInlineEcoAuditChunks,
  ecoAuditReportPointerValues,
  scopeEcoAuditReportPhotos,
} from './pdf.js';

type PdfBodyArgs = Parameters<typeof buildEcoAuditReportOverview>[0];
type PdfZone = PdfBodyArgs['zones'][number];
type PdfPhoto = NonNullable<Parameters<typeof buildEcoAuditReportOverview>[1]>[number];

const generatedAt = new Date('2026-07-30T00:00:00.000Z');

test('derived report pointers do not mutate the audit business revision clocks', () => {
  const values = ecoAuditReportPointerValues('ecoaudit/report.pdf', '/v1/files/report.pdf');
  assert.deepEqual(values, {
    reportPdfLocalPath: 'ecoaudit/report.pdf',
    reportPdfRemoteUrl: '/v1/files/report.pdf',
  });
  assert.equal('updatedAt' in values, false);
  assert.equal('treeRevision' in values, false);
});

test('sync and background PDF paths use one snapshot and CAS before publishing or mirroring', async () => {
  const source = await readFile(new URL('./pdf.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/loadEcoAuditReportSnapshot\(/g) ?? []).length, 3);
  assert.match(source, /isolationLevel: 'repeatable read', accessMode: 'read only'/);
  assert.match(source, /loadCurrentPhotosForParent\(\{[\s\S]*?executor: tx as unknown as typeof db,[\s\S]*?\}\)/);
  assert.match(source, /eq\(eaAudits\.treeRevision, input\.sourceTreeRevision\)/);

  const direct = source.slice(
    source.indexOf('async function handleEcoAuditPdf('),
    source.indexOf('// ── Async job runner'),
  );
  const background = source.slice(
    source.indexOf('export async function runEcoAuditPdfJob('),
    source.indexOf('async function runEcoAuditPdfJobInBackground('),
  );
  const accessIndex = direct.indexOf('assertAuditAccess(assertFound(accessibleAudit');
  const reconcileIndex = direct.indexOf('await reconcilePhotoCopyReferencesForParent({');
  const snapshotIndex = direct.indexOf('await loadEcoAuditReportSnapshot(');
  assert.ok(accessIndex >= 0);
  assert.ok(reconcileIndex > accessIndex);
  assert.ok(snapshotIndex > reconcileIndex);
  for (const pathSource of [direct, background]) {
    const casIndex = pathSource.indexOf('await publishEcoAuditReportPointer({');
    const cleanupIndex = pathSource.indexOf('await deleteLocalFile(storageKey);');
    const mirrorIndex = pathSource.indexOf('await mirrorPdfToOneDrive({');
    assert.ok(casIndex >= 0);
    assert.ok(cleanupIndex > casIndex);
    assert.ok(mirrorIndex > cleanupIndex);
    assert.doesNotMatch(pathSource, /reportPdfRemoteUrl: remoteUrl, updatedAt/);
  }
});

function zone(id: string, zoneName: string): PdfZone {
  return {
    id,
    auditId: 'audit-1',
    zoneName,
    zoneDescription: null,
    photos: [],
    photoDescs: {},
    serverId: null,
    syncStatus: 'synced',
    updatedAt: generatedAt,
    deletedAt: null,
    createdAt: generatedAt,
  };
}

function photo(
  id: string,
  entityId: string,
  overrides: Partial<Pick<PdfPhoto, 'entityType' | 'fieldName'>> = {},
): PdfPhoto {
  return {
    id,
    app: 'ecoaudit',
    parentId: 'audit-1',
    entityType: overrides.entityType ?? 'zone',
    entityId,
    fieldName: overrides.fieldName ?? 'photos[0]',
    checksum: `checksum-${id}`,
    onedriveItemId: null,
    originalFilename: `${id}.jpg`,
    contentType: 'image/jpeg',
    fileSizeBytes: 1024,
    storageKey: `ecoaudit/audit-1/${id}.jpg`,
    remoteUrl: `https://files.example/${id}.jpg`,
    status: 'confirmed',
    baseTreeRevision: null,
    confirmedTreeRevision: null,
    uploadedAt: generatedAt,
    createdAt: generatedAt,
  };
}

function reportArgs(zones: PdfZone[], photos: PdfPhoto[]): PdfBodyArgs {
  return {
    audit: {
      id: 'audit-1',
      siteName: 'Example Site',
      siteAddress: '1 Example Street',
      inspectorName: 'Inspector',
      auditDate: '2026-07-30',
      status: 'Completed',
    } as PdfBodyArgs['audit'],
    zones,
    photos,
    mode: 'by-zone',
    msList: [],
    addlSbList: [],
    hvacList: [],
    lightList: [],
    solarList: [],
    forkliftList: [],
    hotWaterList: [],
    waterAssetList: [],
    genWaterList: [],
    genElecList: [],
    brandLogo: 'data:image/png;base64,logo',
    genDate: 'Jul 30, 2026',
  };
}

test('chunked reports keep global executive counts and do not restart zone numbering', () => {
  const zones = [
    zone('zone-c', 'Zone C'),
    zone('zone-a', 'Zone A'),
    zone('zone-b', 'Zone B'),
  ];
  const photos = [
    ...Array.from({ length: 50 }, (_, index) => photo(`c-${index}`, 'zone-c')),
    ...Array.from({ length: 50 }, (_, index) => photo(`a-${index}`, 'zone-a')),
    ...Array.from({ length: 21 }, (_, index) => photo(`b-${index}`, 'zone-b')),
  ];
  const args = reportArgs(zones, photos);
  const overview = buildEcoAuditReportOverview(args, photos);
  const chunks = buildInlineEcoAuditChunks(args, photos);

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.zones.map((item) => item.id)),
    ['zone-c', 'zone-a', 'zone-b'],
  );
  assert.equal(overview.selectedZoneCount, 3);
  assert.equal(overview.totalPhotos, 121);

  const htmlParts = chunks.map((chunk, index) => buildEcoAuditChunkHtml(
    chunk,
    overview,
    index,
    chunks.length,
  ));

  assert.match(htmlParts[0], /covering 3 zones and 0 captured items/);
  assert.match(htmlParts[0], /<div class="sn">3<\/div><div class="sl">Zones<\/div>/);
  assert.match(htmlParts[0], /<div class="sn">121<\/div><div class="sl">Photos<\/div>/);
  assert.match(htmlParts[0], /<div class="exec-title">Executive Summary<\/div>/);
  assert.doesNotMatch(htmlParts[1], /<div class="exec-title">Executive Summary<\/div>/);
  assert.doesNotMatch(htmlParts.join(''), /zh-num-wrap/);
});

test('General Electricity renders before hot-water and water sections in both report layouts', () => {
  const reportZone = zone('zone-order', 'Order Zone');
  const args: PdfBodyArgs = {
    ...reportArgs([reportZone], []),
    mode: 'by-equipment',
    genElecList: [{
      id: 'electricity-1', auditId: 'audit-1', zoneId: reportZone.id,
      question: 'Electricity observation', answer: 'Recorded', photos: [], extraPhotos: [],
      photoDescs: {},
    }] as PdfBodyArgs['genElecList'],
    hotWaterList: [{
      id: 'hot-water-1', auditId: 'audit-1', zoneId: reportZone.id,
      dhwDetailsType: 'Storage', photoDescs: {},
    }] as PdfBodyArgs['hotWaterList'],
    waterAssetList: [{
      id: 'water-meter-1', auditId: 'audit-1', zoneId: reportZone.id,
      assetType: 'water_meter', name: 'WM-1', category: null, data: {},
      customFields: [], photos: [], photoDescs: {},
    }] as PdfBodyArgs['waterAssetList'],
    genWaterList: [{
      id: 'water-1', auditId: 'audit-1', zoneId: reportZone.id,
      question: 'Water observation', answer: 'Recorded', photos: [], extraPhotos: [],
      photoDescs: {},
    }] as PdfBodyArgs['genWaterList'],
  };
  const equipmentHtml = buildEcoAuditChunkHtml(
    args,
    buildEcoAuditReportOverview(args, []),
    0,
    1,
  );
  const electricitySection = '<span class="sec-bar-name">General Electricity</span>';
  assert.ok(equipmentHtml.indexOf(electricitySection) < equipmentHtml.indexOf('<span class="sec-bar-name">Hot Water Systems</span>'));
  assert.ok(equipmentHtml.indexOf(electricitySection) < equipmentHtml.indexOf('<span class="sec-bar-name">Water Meters</span>'));
  assert.ok(equipmentHtml.indexOf(electricitySection) < equipmentHtml.indexOf('<span class="sec-bar-name">General Water</span>'));

  const zoneArgs = { ...args, mode: 'by-zone' as const };
  const zoneHtml = buildEcoAuditChunkHtml(
    zoneArgs,
    buildEcoAuditReportOverview(zoneArgs, []),
    0,
    1,
  );
  const electricityLabel = '<div class="zone-type-label">General Electricity</div>';
  assert.ok(zoneHtml.indexOf(electricityLabel) < zoneHtml.indexOf('<div class="zone-type-label">Hot Water</div>'));
  assert.ok(zoneHtml.indexOf(electricityLabel) < zoneHtml.indexOf('<div class="zone-type-label">Water Meters</div>'));
  assert.ok(zoneHtml.indexOf(electricityLabel) < zoneHtml.indexOf('<div class="zone-type-label">General Water</div>'));
});

test('executive zone totals include empty zones in the selected report scope', () => {
  const zones = [
    zone('zone-a', 'Zone A'),
    zone('zone-empty', 'Empty Zone'),
  ];
  const photos = [photo('a-1', 'zone-a')];
  const overview = buildEcoAuditReportOverview(reportArgs(zones, photos), photos);

  assert.equal(overview.selectedZoneCount, 2);
  assert.match(overview.executiveSummary, /covering 2 zones/);
});

test('report photo scope excludes deleted-owner, orphaned, and audit-level photos', () => {
  const photos = [
    photo('live-zone-photo', 'zone-a'),
    photo('deleted-zone-photo', 'zone-deleted'),
    photo('orphaned-equipment-photo', 'equipment-deleted'),
    photo('audit-level-photo', 'audit-1'),
  ];
  const scopedPhotos = scopeEcoAuditReportPhotos(photos, new Set(['zone-a']));
  const overview = buildEcoAuditReportOverview(
    reportArgs([zone('zone-a', 'Zone A')], scopedPhotos),
    scopedPhotos,
  );

  assert.deepEqual(scopedPhotos.map((item) => item.id), ['live-zone-photo']);
  assert.equal(overview.totalPhotos, 1);
});

test('executive photo totals exclude images that could not be prepared for rendering', () => {
  const renderablePhoto = photo('renderable-photo', 'zone-a');
  const skippedPhoto = { ...photo('skipped-photo', 'zone-a'), remoteUrl: null };
  const overview = buildEcoAuditReportOverview(
    reportArgs([zone('zone-a', 'Zone A')], [renderablePhoto, skippedPhoto]),
    [renderablePhoto, skippedPhoto],
  );

  assert.equal(overview.totalPhotos, 1);
});

test('zone and equipment photos remain in their owning PDF sections in both report modes', () => {
  const zonePhotoUrl = 'https://files.example/zone-evidence.jpg';
  const lightingPhotoUrl = 'https://files.example/lighting-evidence.jpg';
  const reportZone = {
    ...zone('zone-a', 'Zone A'),
    photos: [zonePhotoUrl],
    photoDescs: {
      'photos.0': { name: 'Zone evidence' },
    },
  };
  const lighting = {
    id: 'lighting-a',
    auditId: 'audit-1',
    zoneId: reportZone.id,
    lightType: 'LED High Bay',
    photo: lightingPhotoUrl,
    photoDescs: {
      photo: { name: 'Lighting evidence' },
    },
  };
  const photos = [
    photo('zone-evidence', reportZone.id),
    photo('lighting-evidence', lighting.id, {
      entityType: 'lighting_system',
      fieldName: 'photo',
    }),
  ];

  for (const mode of ['by-zone', 'by-equipment'] as const) {
    const args = {
      ...reportArgs([reportZone], photos),
      mode,
      lightList: [lighting],
    };
    const overview = buildEcoAuditReportOverview(args, photos);
    const chunks = buildInlineEcoAuditChunks(args, photos);
    const htmlParts = chunks.map((chunk, index) => buildEcoAuditChunkHtml(
      chunk,
      overview,
      index,
      chunks.length,
    ));

    if (mode === 'by-zone') {
      assert.equal(htmlParts.length, 1);
      const html = htmlParts[0];
      const zoneSection = html.indexOf('<span>Zone Photos</span>');
      const zonePhoto = html.indexOf(zonePhotoUrl);
      const lightingSection = html.indexOf(
        '<div class="zone-type-label">Lighting Systems</div>',
      );
      const lightingPhoto = html.indexOf(lightingPhotoUrl);

      assert.ok(zoneSection >= 0);
      assert.ok(zoneSection < zonePhoto);
      assert.ok(zonePhoto < lightingSection);
      assert.ok(lightingSection < lightingPhoto);
      assert.match(html.slice(zoneSection, lightingSection), /Zone evidence/);
      assert.doesNotMatch(
        html.slice(zoneSection, lightingSection),
        /lighting-evidence|Lighting evidence/,
      );
      assert.match(html.slice(lightingSection), /Lighting evidence/);
      continue;
    }

    assert.equal(htmlParts.length, 2);
    assert.match(htmlParts[0], /<span class="sec-bar-name">Zone Photos<\/span>/);
    assert.match(htmlParts[0], /zone-evidence\.jpg/);
    assert.doesNotMatch(htmlParts[0], /lighting-evidence|Lighting evidence/);
    assert.match(htmlParts[1], /<span class="sec-bar-name">Lighting Systems<\/span>/);
    assert.match(htmlParts[1], /lighting-evidence\.jpg/);
    assert.match(htmlParts[1], /Lighting evidence/);
    assert.doesNotMatch(htmlParts[1], /zone-evidence|Zone evidence/);
  }
});

test('all water asset subtypes render their fields, calculations, custom answers, and labelled photos', () => {
  const reportZone = zone('zone-water', 'Water Services');
  const waterAssets = [
    {
      id: 'water-meter-1',
      auditId: 'audit-1',
      zoneId: reportZone.id,
      assetType: 'water_meter',
      name: 'GWW Main Incomer',
      category: null,
      data: JSON.stringify({
        meterType: 'Electromagnetic',
        waterSupplyType: 'Potable Main',
        meterSizeMm: 100,
        currentMeterReadingKl: 12548.3,
      }),
      generalComments: 'Meter is operating normally.',
      customFields: [],
      photos: [],
      photoDescs: {},
    },
    {
      id: 'water-submeter-1',
      auditId: 'audit-1',
      zoneId: reportZone.id,
      assetType: 'water_submeter_logger',
      name: 'BMS-WM-01',
      category: null,
      data: {
        connectedToBms: 'Dry-contact available',
        dataLoggerFitted: 'Other',
        dataLoggerOther: 'Site telemetry gateway',
        pulseWeight: '1 pulse = 10 L',
      },
      generalComments: null,
      customFields: [],
      photos: [],
      photoDescs: {},
    },
    {
      id: 'water-fixture-1',
      auditId: 'audit-1',
      zoneId: reportZone.id,
      assetType: 'water_fixture',
      name: 'Main Kitchen Dishwasher',
      category: 'Dishwasher',
      data: {
        waterConsumptionLPerCycle: 9.5,
        rinseCycleMode: 'Recirculated',
      },
      generalComments: null,
      customFields: [],
      photos: [],
      photoDescs: {},
    },
    {
      id: 'water-system-1',
      auditId: 'audit-1',
      zoneId: reportZone.id,
      assetType: 'water_asset_system',
      name: 'Leak NW-01',
      category: 'Network Leak / Pipework Defect',
      data: {
        specificLocationRoomLine: 'North plant room line 2',
        estimatedLeakRateLHr: 10,
        estimatedRectificationCostAud: 750,
      },
      generalComments: 'Repair during next shutdown.',
      customFields: [{
        id: 'custom-1',
        question: 'Isolation required?',
        answer: 'Yes, isolate line 2',
        photos: ['https://files.example/leak-close-up.jpg'],
        photoDescs: {
          'photos.0': { name: 'Defect close-up', largeInPdf: true },
        },
      }],
      photos: [],
      photoDescs: {},
    },
  ];
  const waterPhoto = photo('water-photo-1', 'water-system-1', {
    entityType: 'water_asset',
    fieldName: 'customFields.custom-1.photos.0',
  });
  waterPhoto.remoteUrl = 'https://files.example/leak-close-up.jpg';
  const args = {
    ...reportArgs([reportZone], [waterPhoto]),
    mode: 'by-equipment' as const,
    waterAssetList: waterAssets,
  };
  const overview = buildEcoAuditReportOverview(args, [waterPhoto]);
  const html = buildEcoAuditChunkHtml(args, overview, 0, 1);

  assert.equal(overview.waterAssetCount, 4);
  assert.equal(overview.totalEquipment, 4);
  assert.match(html, /<span class="sec-bar-name">Water Meters<\/span>/);
  assert.match(html, /<span class="sec-bar-name">Water Submeters \/ Loggers<\/span>/);
  assert.match(html, /<span class="sec-bar-name">Water Fixtures<\/span>/);
  assert.match(html, /<span class="sec-bar-name">Water Assets \/ Systems<\/span>/);
  assert.match(html, /Electromagnetic/);
  assert.match(html, /Site telemetry gateway/);
  assert.match(html, /9\.5 L\/rack or cycle/);
  assert.match(html, /87\.60 kL\/year/);
  assert.match(html, /Custom: Isolation required\?/);
  assert.match(html, /Defect close-up/);
  assert.match(html, /photo-large-img/);

  const zoneArgs = { ...args, mode: 'by-zone' as const };
  const zoneHtml = buildEcoAuditChunkHtml(
    zoneArgs,
    buildEcoAuditReportOverview(zoneArgs, [waterPhoto]),
    0,
    1,
  );
  assert.match(zoneHtml, /<div class="zone-type-label">Water Meters<\/div>/);
  assert.match(zoneHtml, /<div class="zone-type-label">Water Submeters \/ Loggers<\/div>/);
  assert.match(zoneHtml, /<div class="zone-type-label">Water Fixtures<\/div>/);
  assert.match(zoneHtml, /<div class="zone-type-label">Water Assets \/ Systems<\/div>/);
});
