import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEcoAuditChunkHtml,
  buildEcoAuditReportOverview,
  buildInlineEcoAuditChunks,
  scopeEcoAuditReportPhotos,
} from './pdf.js';

type PdfBodyArgs = Parameters<typeof buildEcoAuditReportOverview>[0];
type PdfZone = PdfBodyArgs['zones'][number];
type PdfPhoto = NonNullable<Parameters<typeof buildEcoAuditReportOverview>[1]>[number];

const generatedAt = new Date('2026-07-30T00:00:00.000Z');

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
