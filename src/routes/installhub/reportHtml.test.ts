import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSTALLHUB_LARGE_REPORT_PHOTO_COUNT,
  INSTALLHUB_LARGE_REPORT_RAW_BYTES,
  MissingInstallHubReportEvidenceError,
  buildInstallHubReportHtml,
  installHubReportNeedsChunks,
  installHubReportPhotoTotals,
  planInstallHubFormReportSlices,
  resolveInstallHubFormPhotos,
  safeInstallHubReportFailure,
  visibleInstallHubReportSectionIndexes,
  type InstallHubReportForm,
  type InstallHubReportInstallation,
  type InstallHubReportPhoto,
  type InstallHubCanonicalReport,
  type ResolvedInstallHubFormPhoto,
} from './reportHtml.js';
import {
  INSTALLHUB_REPORT_DEFINITIONS,
  INSTALLHUB_REPORT_DEFINITION_BY_TYPE,
  INSTALLHUB_REPORT_MANIFEST_VERSION,
  isReportItemVisible,
} from './reportManifest.js';

const installation: InstallHubReportInstallation = {
  id: 'installation-1',
  clientName: 'Example Client',
  siteName: 'Example Site',
  siteAddress: '1 Example Street',
  inspectorName: 'Inspector',
  auditDate: '2026-07-23',
  status: 'Completed',
};

function form(
  overrides: Partial<InstallHubReportForm> = {},
): InstallHubReportForm {
  return {
    id: 'form-1',
    installationId: installation.id,
    formType: 'honeywell-q400',
    schemaVersion: 2,
    status: 'Completed',
    answers: {},
    attachments: [],
    ...overrides,
  };
}

function photo(
  overrides: Partial<InstallHubReportPhoto> = {},
): InstallHubReportPhoto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    entityId: 'form-1',
    fieldName: 'attachments[0].uri',
    storageKey: 'installhub/example/original.jpg',
    remoteUrl: 'https://files.example/original.jpg',
    fileSizeBytes: 1024,
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  };
}

function resolved(
  attachmentIndex: number,
  slot: string,
  id = `00000000-0000-4000-8000-${String(attachmentIndex + 1).padStart(12, '0')}`,
): ResolvedInstallHubFormPhoto {
  return {
    attachmentIndex,
    slot,
    photo: photo({
      id,
      fieldName: `attachments[${attachmentIndex}].uri`,
    }),
  };
}

test('report manifest is versioned and covers all six current and two legacy forms', () => {
  assert.equal(INSTALLHUB_REPORT_MANIFEST_VERSION, 1);
  assert.deepEqual(
    new Set(INSTALLHUB_REPORT_DEFINITIONS.map((definition) => definition.type)),
    new Set([
      'ww-installation',
      'comms-fault',
      'ace-switchboard',
      'honeywell-q400',
      'captis-logger',
      'sums-logger',
      'a3rm-installation',
      'a6m-installation',
    ]),
  );
  assert.equal(
    INSTALLHUB_REPORT_DEFINITIONS.length,
    Object.keys(INSTALLHUB_REPORT_DEFINITION_BY_TYPE).length,
  );
  assert.equal(
    INSTALLHUB_REPORT_DEFINITION_BY_TYPE['comms-fault'].title,
    'SW MaaS - Comms Fault',
  );
});

test('dynamic installation report sections follow A3RM and A6M channel visibility', () => {
  const definition = INSTALLHUB_REPORT_DEFINITION_BY_TYPE['ww-installation'];
  const sectionTitles = (answers: Record<string, string>) =>
    visibleInstallHubReportSectionIndexes(form({
      formType: 'ww-installation',
      answers,
    })).map((index) => definition.sections[index]?.title);

  const a3rm = sectionTitles({ 'device.type': 'A3RM' });
  assert.ok(a3rm.includes('Channel 3'));
  assert.ok(!a3rm.includes('Channel 4'));
  assert.ok(!a3rm.includes('Channel 6'));

  const a6m = sectionTitles({ 'device.type': 'A6M' });
  assert.ok(a6m.includes('Channel 3'));
  assert.ok(a6m.includes('Channel 4'));
  assert.ok(a6m.includes('Channel 6'));
});

test('legacy WW reports show commissioning for Base44 and persisted sensor vocabularies', () => {
  const visibility = (formType: 'a3rm-installation' | 'a6m-installation') => {
    const field = INSTALLHUB_REPORT_DEFINITION_BY_TYPE[formType].sections
      .flatMap((section) => section.fields)
      .find((candidate) => candidate.key === 'commissioning.channel_1_current');
    assert.ok(field?.showWhen);
    return field.showWhen;
  };

  const a3rm = visibility('a3rm-installation');
  assert.equal(isReportItemVisible(a3rm, { 'channel.1.rating': '10cm-200A' }), true);
  assert.equal(isReportItemVisible(a3rm, { 'channel.1.rating': '3000A - 9cm' }), true);
  assert.equal(isReportItemVisible(a3rm, { 'channel.1.rating': 'Not Used' }), false);

  const a6m = visibility('a6m-installation');
  assert.equal(isReportItemVisible(a6m, { 'channel.1.rating': 'CT-60A' }), true);
  assert.equal(isReportItemVisible(a6m, { 'channel.1.rating': '60A' }), true);
  assert.equal(isReportItemVisible(a6m, { 'channel.1.rating': 'Not Used' }), false);
});

test('WW report preserves production device and map fields plus the antenna photo instruction', () => {
  const fields = INSTALLHUB_REPORT_DEFINITION_BY_TYPE['ww-installation'].sections
    .flatMap((section) => section.fields);
  assert.ok(fields.some((field) => field.key === 'device.id' && field.label === 'Device ID / serial'));
  assert.ok(fields.some((field) => field.key === 'device.name' && field.label === 'Device name'));
  assert.equal(fields.some((field) => field.key === 'device.number'), true);
  assert.ok(fields.some((field) => (
    field.key === 'auditor.address_map_locator'
    && field.label === 'Address map locator (latitude / longitude)'
  )));
  assert.ok(fields.some((field) => (
    field.key === 'commissioning.completed_photos'
    && field.label === 'Completed installation photos (include the antenna)'
  )));
});

test('communications report preserves existing and replacement device numbers', () => {
  const fields = INSTALLHUB_REPORT_DEFINITION_BY_TYPE['comms-fault'].sections
    .flatMap((section) => section.fields);
  assert.ok(fields.some((field) => field.key === 'existing.device_number'));
  assert.ok(fields.some((field) => field.key === 'works.new_device_number'));
});

test('photo evidence resolves only through the exact attachment registry field', () => {
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondUri = 'https://files.example/completed.jpg';
  const reportForm = form({
    attachments: [
      {
        slot: 'water.lcd_photo',
        uri: `file:///captured/${firstId}.jpg`,
      },
      {
        slot: 'water.completed_photo',
        uri: secondUri,
        caption: 'Completed installation',
      },
    ],
  });
  const resolvedPhotos = resolveInstallHubFormPhotos(reportForm, [
    photo({
      id: firstId,
      fieldName: 'attachments[0].uri',
      remoteUrl: 'https://files.example/uuid-match.jpg',
    }),
    photo({
      id: '22222222-2222-4222-8222-222222222222',
      fieldName: 'attachments[0].uri',
      remoteUrl: 'https://files.example/newer-but-not-referenced.jpg',
      createdAt: '2026-07-23T01:00:00.000Z',
    }),
    photo({
      id: '33333333-3333-4333-8333-333333333333',
      fieldName: 'attachments[1].uri',
      remoteUrl: secondUri,
    }),
    photo({
      id: '44444444-4444-4444-8444-444444444444',
      fieldName: 'some-other-field',
      remoteUrl: secondUri,
    }),
    photo({
      id: '55555555-5555-4555-8555-555555555555',
      entityId: 'another-form',
      fieldName: 'attachments[1].uri',
      remoteUrl: secondUri,
    }),
  ]);

  assert.deepEqual(
    resolvedPhotos.map((item) => item.photo.id),
    [firstId, '33333333-3333-4333-8333-333333333333'],
  );
  assert.equal(resolvedPhotos[1]?.caption, 'Completed installation');
});

test('reindexed evidence resolves the attachment UUID when an obsolete direct row shares its field', () => {
  const installationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const removedId = '11111111-1111-4111-8111-111111111111';
  const shiftedId = '22222222-2222-4222-8222-222222222222';
  const reportForm = form({
    attachments: [{
      slot: 'water.completed_photo',
      uri: `https://files.example/installhub/${installationId}/photo-${shiftedId}.jpg`,
      caption: 'Completed installation',
    }],
  });

  const [resolvedPhoto] = resolveInstallHubFormPhotos(reportForm, [
    photo({
      id: removedId,
      fieldName: 'attachments[0].uri',
      remoteUrl: `https://files.example/installhub/${installationId}/photo-${removedId}.jpg`,
    }),
    photo({
      id: shiftedId,
      fieldName: 'attachments[0].uri',
      remoteUrl: `https://files.example/installhub/${installationId}/photo-${shiftedId}.jpg`,
      createdAt: '2026-07-23T01:00:00.000Z',
    }),
  ]);

  assert.equal(resolvedPhoto?.photo.id, shiftedId);
  assert.equal(resolvedPhoto?.caption, 'Completed installation');
});

test('reindexed evidence never substitutes an obsolete direct photo when its alias is missing', () => {
  const removedId = '11111111-1111-4111-8111-111111111111';
  const shiftedId = '22222222-2222-4222-8222-222222222222';
  const reportForm = form({
    attachments: [{
      slot: 'water.completed_photo',
      uri: `https://files.example/photo-${shiftedId}.jpg`,
    }],
  });

  assert.throws(
    () => resolveInstallHubFormPhotos(reportForm, [
      photo({
        id: removedId,
        fieldName: 'attachments[0].uri',
        remoteUrl: `https://files.example/photo-${removedId}.jpg`,
      }),
    ]),
    (error: unknown) => {
      assert.ok(error instanceof MissingInstallHubReportEvidenceError);
      assert.deepEqual(error.attachmentIndexes, [0]);
      return true;
    },
  );
});

test('missing backed evidence fails with the exact attachment identities', () => {
  const reportForm = form({
    attachments: [
      {
        slot: 'water.lcd_photo',
        uri: 'https://files.example/original.jpg',
      },
      { slot: 'water.completed_photo', uri: 'file:///completed.jpg' },
    ],
  });

  assert.throws(
    () => resolveInstallHubFormPhotos(reportForm, [
      photo({
        fieldName: 'attachments[0].uri',
      }),
    ]),
    (error: unknown) => {
      assert.ok(error instanceof MissingInstallHubReportEvidenceError);
      assert.deepEqual(error.attachmentIndexes, [1]);
      assert.match(error.message, /attachments\[1\]\.uri/);
      return true;
    },
  );
});

test('live diagnostic drafts tolerate missing evidence instead of aborting rendering', () => {
  const draft = form({
    status: 'Draft',
    attachments: [{
      slot: 'water.completed_photo',
      uri: 'file:///device-only/unconfirmed.jpg',
    }],
  });
  assert.deepEqual(resolveInstallHubFormPhotos(draft, [], {
    allowMissingEvidence: true,
  }), []);
});

test('large-report thresholds are strict and photo totals deduplicate originals', () => {
  const shared = resolved(0, 'water.lcd_photo');
  const totals = installHubReportPhotoTotals([
    shared,
    {
      ...shared,
      attachmentIndex: 1,
      slot: 'water.completed_photo',
    },
  ]);
  assert.deepEqual(totals, { count: 1, rawBytes: 1024 });
  assert.equal(installHubReportNeedsChunks({
    count: INSTALLHUB_LARGE_REPORT_PHOTO_COUNT,
    rawBytes: INSTALLHUB_LARGE_REPORT_RAW_BYTES,
  }), false);
  assert.equal(installHubReportNeedsChunks({
    count: INSTALLHUB_LARGE_REPORT_PHOTO_COUNT + 1,
    rawBytes: 0,
  }), true);
  assert.equal(installHubReportNeedsChunks({
    count: 0,
    rawBytes: INSTALLHUB_LARGE_REPORT_RAW_BYTES + 1,
  }), true);
});

test('large forms split near the target only at report section boundaries', () => {
  const reportForm = form({
    formType: 'ww-installation',
    answers: {
      'device.type': 'A3RM',
      'channel.1.load': 'Mains Supply',
      'channel.2.load': 'HVAC',
    },
  });
  const photos = [
    resolved(0, 'auditor.location_before'),
    resolved(1, 'auditor.location_before'),
    resolved(2, 'auditor.location_before'),
    resolved(3, 'channel.1.nameplate_photos'),
    resolved(4, 'channel.1.nameplate_photos'),
    resolved(5, 'channel.1.nameplate_photos'),
    resolved(6, 'channel.2.nameplate_photos'),
    resolved(7, 'channel.2.nameplate_photos'),
    resolved(8, 'channel.2.nameplate_photos'),
  ];
  const slices = planInstallHubFormReportSlices(reportForm, photos, 5);

  assert.deepEqual(slices.map((slice) => slice.photoCount), [3, 3, 3]);
  assert.deepEqual(
    slices.map((slice) => slice.continuation),
    [false, true, true],
  );
  assert.deepEqual(
    slices.flatMap((slice) => slice.sectionIndexes),
    visibleInstallHubReportSectionIndexes(reportForm),
  );
});

test('HTML uses the Sustainability Wise A4 frame, contains photos, and escapes data', () => {
  const reportForm = form({
    answers: {
      'site.customer_name': '<script>alert("x")</script> & Client',
      'site.date_time': '2026-07-26T12:00:00.000Z',
      'installer.name': 'Installer',
      'water.serial_number': 'Q400-123',
    },
    attachments: [
      { slot: 'water.lcd_photo', uri: 'file:///lcd.jpg' },
    ],
  });
  const reportPhotos = [
    {
      ...resolved(0, 'water.lcd_photo'),
      photo: photo({
        remoteUrl: 'data:image/jpeg;base64,ZmFrZQ==',
      }),
    },
  ];
  const sectionIndexes = visibleInstallHubReportSectionIndexes(reportForm);
  const html = buildInstallHubReportHtml({
    mode: 'installation-pack',
    installation,
    forms: [reportForm],
    slices: [{
      formId: reportForm.id,
      sectionIndexes,
      continuation: false,
      photoCount: reportPhotos.length,
    }],
    resolvedByForm: new Map([[reportForm.id, reportPhotos]]),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    includeIntro: true,
    includeEnd: true,
    generatedLabel: 'Generated 23/07/2026',
    summaryPhotoCount: 125,
  });

  assert.match(html, /@page\{size:A4/);
  assert.match(html, /data-pdf-header/);
  assert.match(html, /data-pdf-footer/);
  assert.match(html, /data-page-numbers="true"/);
  assert.match(html, /#1E3A8A/);
  assert.match(html, /object-fit:contain/);
  assert.match(html, /data:image\/png;base64,bG9nbw==/);
  assert.match(html, /data:image\/jpeg;base64,ZmFrZQ==/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; Client/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /26\/07\/2026, 22:00/);
  assert.doesNotMatch(html, /2026-07-26T12:00:00\.000Z/);
  assert.match(html, /23\/07\/2026/);
  assert.match(html, /<span>125<\/span>Evidence photos/);
  assert.match(html, /Field App Complete installation record/);
  assert.match(html, /Field App Complete report manifest v1/);
});

test('HTML renders escaped attachment captions and falls back to the evidence label', () => {
  const reportForm = form({
    attachments: [
      {
        slot: 'water.lcd_photo',
        uri: 'https://files.example/lcd.jpg',
        caption: '<caption>Panel 4 0 2</caption>',
      },
      {
        slot: 'water.completed_photo',
        uri: 'https://files.example/completed.jpg',
      },
    ],
  });
  const reportPhotos = [
    {
      ...resolved(0, 'water.lcd_photo'),
      caption: '<caption>Panel 4 0 2</caption>',
      photo: photo({
        remoteUrl: 'data:image/jpeg;base64,bGNk',
      }),
    },
    {
      ...resolved(1, 'water.completed_photo'),
      photo: photo({
        remoteUrl: 'data:image/jpeg;base64,Y29tcGxldGVk',
      }),
    },
  ];
  const html = buildInstallHubReportHtml({
    mode: 'form',
    installation,
    forms: [reportForm],
    slices: [{
      formId: reportForm.id,
      sectionIndexes: visibleInstallHubReportSectionIndexes(reportForm),
      continuation: false,
      photoCount: reportPhotos.length,
    }],
    resolvedByForm: new Map([[reportForm.id, reportPhotos]]),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    includeIntro: false,
    includeEnd: false,
    generatedLabel: 'Generated 26/07/2026',
  });

  assert.match(
    html,
    /&lt;caption&gt;Panel 4 0 2&lt;\/caption&gt;/,
  );
  assert.doesNotMatch(html, /<caption>Panel 4 0 2<\/caption>/);
  assert.match(html, /Completed water-meter installation/);
});

test('canonical form with optional evidence omitted renders safely without leaking a local URI', () => {
  const omittedLocalUri = 'file:///private/field-app/pending-water-meter-photo.jpg';
  const reportForm = form({ attachments: [] });
  const reportPhotos = resolveInstallHubFormPhotos(reportForm, []);

  assert.deepEqual(reportPhotos, []);
  const html = buildInstallHubReportHtml({
    mode: 'form',
    installation,
    forms: [reportForm],
    slices: [{
      formId: reportForm.id,
      sectionIndexes: visibleInstallHubReportSectionIndexes(reportForm),
      continuation: false,
      photoCount: 0,
    }],
    resolvedByForm: new Map([[reportForm.id, reportPhotos]]),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    includeIntro: false,
    includeEnd: false,
    generatedLabel: 'Generated 07/08/2026',
  });

  assert.match(html, /No photo provided/);
  assert.equal(html.includes(omittedLocalUri), false);
  assert.doesNotMatch(html, /file:\/\//);
});

test('conditional sections retain contiguous visible numbering', () => {
  const reportForm = form({
    formType: 'ww-installation',
    answers: {
      'device.type': 'A3RM',
      'channel.1.load': 'Not Used',
      'channel.2.load': 'Not Used',
      'channel.3.load': 'Not Used',
    },
  });
  const sectionIndexes = visibleInstallHubReportSectionIndexes(reportForm);
  const html = buildInstallHubReportHtml({
    mode: 'form',
    installation,
    forms: [reportForm],
    slices: [{
      formId: reportForm.id,
      sectionIndexes,
      continuation: false,
      photoCount: 0,
    }],
    resolvedByForm: new Map([[reportForm.id, []]]),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    includeIntro: false,
    includeEnd: false,
    generatedLabel: 'Generated 23/07/2026',
  });

  const renderedNumbers = [...html.matchAll(
    /class="section-number">(\d+)<\/span>/g,
  )].map((match) => Number(match[1]));
  assert.deepEqual(
    renderedNumbers,
    sectionIndexes.map((_, index) => index + 1),
  );
});

test('communications replacement-only fields stay out of non-replacement reports', () => {
  const noReplacement = form({
    formType: 'comms-fault',
    answers: {
      'works.replace_device': 'no',
    },
  });
  const render = (reportForm: InstallHubReportForm) =>
    buildInstallHubReportHtml({
      mode: 'form',
      installation,
      forms: [reportForm],
      slices: [{
        formId: reportForm.id,
        sectionIndexes: visibleInstallHubReportSectionIndexes(reportForm),
        continuation: false,
        photoCount: 0,
      }],
      resolvedByForm: new Map([[reportForm.id, []]]),
      logoDataUri: 'data:image/png;base64,bG9nbw==',
      includeIntro: false,
      includeEnd: false,
      generatedLabel: 'Generated 23/07/2026',
    });

  assert.doesNotMatch(
    render(noReplacement),
    /WW Onboarding App completed for the new device/,
  );
  assert.doesNotMatch(render(noReplacement), /Start page screenshot/);
  assert.match(
    render(form({
      formType: 'comms-fault',
      answers: {
        'works.replace_device': 'yes',
      },
    })),
    /WW Onboarding App completed for the new device/,
  );
});

test('report failures never persist evidence ids, URLs, or storage paths', () => {
  const secret = 'https://files.example/private/11111111-1111-4111-8111-111111111111?token=secret';
  const failure = safeInstallHubReportFailure(new Error(secret));
  assert.deepEqual(failure, {
    code: 'report_generation_failed',
    publicMessage: 'The report could not be generated.',
  });
  assert.equal(JSON.stringify(failure).includes('11111111'), false);
  assert.equal(JSON.stringify(failure).includes('token'), false);
});

test('pinned canonical report HTML is deterministic and includes authoritative sections', () => {
  const canonicalReport: InstallHubCanonicalReport = {
    reportSource: 'canonical-version',
    treeRevision: 12,
    recordVersionNumber: 7,
    snapshotPayloadHash: 'snapshot-hash-7',
    mappingContentHash: 'mapping-hash-7',
    authoritative: true,
    readyToComplete: true,
    physicalLocations: [{
      id: 'zone-plant',
      name: 'Plant room',
      description: 'Main electrical services',
    }],
    electricalNodes: [{
      id: 'board-1',
      kind: 'BOARD',
      name: 'Main board',
      displayCode: 'SITE-MSB-001',
      physicalLocationId: 'zone-plant',
    }, {
      id: 'asset-1',
      kind: 'SITE_ASSET',
      name: 'Air conditioner',
      displayCode: 'SITE-HVAC-001',
      typeLabel: 'AC / HVAC',
      physicalLocationId: 'zone-plant',
    }],
    supplyEdges: [{
      sourceNodeId: 'grid-1',
      targetNodeId: 'board-1',
      relationship: 'FED_FROM',
    }],
    measurementEdges: [{
      sourceNodeId: 'board-1',
      targetNodeId: 'asset-1',
      relationship: 'MEASURES',
    }],
    meters: [{
      id: 'meter-1',
      installedOnBoardId: 'board-1',
      name: 'SITE-A3RM-001',
      model: 'A3RM',
      serialNumber: 'SERIAL-1',
      channels: [{
        ordinal: 1,
        purpose: 'SUB_CIRCUIT',
        load: 'HVAC',
        description: 'Main refrigeration feed',
      }],
    }],
    unresolvedRelationships: [],
    assets: [{
      id: 'asset-1',
      name: 'Air conditioner',
      displayCode: 'SITE-HVAC-001',
      typeLabel: 'AC / HVAC',
      zoneId: 'zone-plant',
      zoneName: 'Plant room',
      coverage: { kind: 'VIRTUAL', virtualMeterId: 'virtual-1' },
    }],
    meteringRows: [{
      assignmentId: 'assignment-1',
      meterDisplayName: 'SITE-A3RM-001',
      channelOrdinal: 1,
      target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
      direction: 'CONSUMPTION',
    }],
    virtualMeterDefinitions: [{
      id: 'virtual-1',
      parentNodeId: 'board-1',
      totalMeasurementAssignmentId: 'assignment-total',
      subtractAssignmentIds: ['assignment-1'],
      formula: 'TOTAL(assignment-total) - SUM(assignment-1)',
      formulaVersion: 1,
      allocation: 'UNALLOCATED_RESIDUAL',
      coverage: [{
        assetId: 'asset-1',
        displayCode: 'SITE-HVAC-001',
        assetName: 'Air conditioner',
        zoneName: 'Plant room',
      }],
    }],
    readinessIssues: [],
  };
  const render = () => buildInstallHubReportHtml({
    mode: 'installation-pack',
    installation,
    forms: [],
    slices: [],
    resolvedByForm: new Map(),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    includeIntro: true,
    includeEnd: true,
    generatedLabel: 'Generated 01/08/2026',
    canonicalReport,
  });
  const first = render();
  const second = render();
  assert.equal(first, second);
  assert.match(first, /Pinned canonical installation/);
  assert.match(first, /Report source canonical-version/);
  assert.doesNotMatch(first, /NON-AUTHORITATIVE/);
  assert.match(first, /Details by electrical hierarchy/);
  assert.match(first, /Plant room/);
  assert.match(first, /Incoming supply to connected loads/);
  assert.match(first, /Installed device: SITE-A3RM-001 - A3RM - channels 1 \(HVAC - Main refrigeration feed\)/);
  assert.match(first, /Measured by: SITE-A3RM-001 channel 1 \(HVAC - Main refrigeration feed\)/);
  assert.match(first, /Calculated residuals/);
  assert.match(first, /TOTAL\(assignment-total\) - SUM\(assignment-1\)/);
  assert.match(first, /calculated residual, not a direct meter reading/);
  assert.match(first, /Readiness/);
  assert.match(first, /snapshot-hash-7/);
  assert.match(first, /mapping-hash-7/);
  assert.match(first, /Generated 01\/08\/2026/);
});

test('live diagnostic HTML labels mutable data and shows draft forms, blockers, and unresolved TBC relationships', () => {
  const draftForm = form({ id: 'draft-form', status: 'Draft' });
  const diagnosticReport: InstallHubCanonicalReport = {
    reportSource: 'diagnostic-live',
    treeRevision: 13,
    recordVersionNumber: null,
    snapshotPayloadHash: null,
    mappingContentHash: null,
    authoritative: false,
    readyToComplete: false,
    physicalLocations: [{ id: 'zone-1', name: 'Plant room' }],
    electricalNodes: [{
      id: 'board-tbc',
      kind: 'BOARD',
      name: 'Unresolved board',
      displayCode: 'SITE-MSB-001',
      physicalLocationId: 'zone-1',
    }],
    supplyEdges: [],
    measurementEdges: [],
    meters: [],
    unresolvedRelationships: [{
      id: 'unresolved-board-tbc',
      subjectType: 'BOARD',
      subjectId: 'board-tbc',
      relation: 'SUPPLY',
      missingEnd: 'SOURCE',
      reason: 'TBC',
    }],
    assets: [],
    meteringRows: [],
    virtualMeterDefinitions: [],
    readinessIssues: [{
      code: 'SUPPLY_TBC',
      entityType: 'board',
      entityId: 'board-tbc',
      message: 'Electrical supply remains TBC.',
    }],
  };
  const html = buildInstallHubReportHtml({
    mode: 'installation-pack',
    installation: { ...installation, status: 'Draft' },
    forms: [draftForm],
    slices: [{
      formId: draftForm.id,
      sectionIndexes: visibleInstallHubReportSectionIndexes(draftForm),
      continuation: false,
      photoCount: 0,
    }],
    resolvedByForm: new Map([[draftForm.id, []]]),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    includeIntro: true,
    includeEnd: true,
    generatedLabel: 'Generated 01/08/2026',
    canonicalReport: diagnosticReport,
  });

  assert.match(html, /Current installation diagnostic/);
  assert.match(html, /Report source diagnostic-live/);
  assert.match(html, /NON-AUTHORITATIVE/);
  assert.match(html, /Not pinned to a canonical record version or payload hash/);
  assert.match(html, /SUPPLY_TBC/);
  assert.match(html, /Unresolved relationships/);
  assert.match(html, /SUPPLY TBC/);
  assert.match(html, /Submission draft-form .* Draft/);
  assert.doesNotMatch(html, /snapshot-hash/);
  assert.doesNotMatch(html, /Pinned canonical installation/);
});

test('installation packs embed the electrical map once and render only the selected detail grouping', () => {
  const canonicalReport: InstallHubCanonicalReport = {
    reportSource: 'canonical-version',
    treeRevision: 3,
    recordVersionNumber: 2,
    snapshotPayloadHash: 'snapshot-2',
    mappingContentHash: 'mapping-2',
    authoritative: true,
    readyToComplete: true,
    physicalLocations: [{ id: 'zone-1', name: 'Workshop' }],
    electricalNodes: [{
      id: 'asset-1',
      kind: 'SITE_ASSET',
      name: 'Workshop lighting',
      displayCode: 'SITE-LX-001',
      typeLabel: 'Lighting',
      physicalLocationId: 'zone-1',
      coverageState: 'DIRECT',
    }],
    supplyEdges: [],
    measurementEdges: [],
    meters: [],
    unresolvedRelationships: [],
    assets: [],
    meteringRows: [],
    virtualMeterDefinitions: [],
    readinessIssues: [],
  };
  const html = buildInstallHubReportHtml({
    mode: 'installation-pack',
    detailMode: 'by-zone',
    installation,
    forms: [],
    slices: [],
    resolvedByForm: new Map(),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    electricalMapDataUri: 'data:image/png;base64,bWFw',
    includeIntro: true,
    includeEnd: true,
    generatedLabel: 'Generated 01/08/2026',
    canonicalReport,
  });
  assert.equal(html.match(/src="data:image\/png;base64,bWFw"/g)?.length, 1);
  assert.doesNotMatch(html, /\.electrical-map\{page-break-before:always/);
  assert.match(html, /Details by physical zone/);
  assert.match(html, /Workshop lighting/);
  assert.match(html, /data-pdf-icon="lighting"/);
  assert.doesNotMatch(html, /Details by electrical hierarchy/);

  const continuation = buildInstallHubReportHtml({
    mode: 'installation-pack',
    detailMode: 'by-zone',
    installation,
    forms: [],
    slices: [],
    resolvedByForm: new Map(),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    electricalMapDataUri: 'data:image/png;base64,bWFw',
    includeIntro: false,
    includeEnd: true,
    generatedLabel: 'Generated 01/08/2026',
    canonicalReport,
  });
  assert.doesNotMatch(continuation, /src="data:image\/png;base64,bWFw"/);
  assert.doesNotMatch(continuation, /Details by physical zone/);
});

test('capped electrical maps keep the complete overview and add an indexed hierarchy fallback', () => {
  const canonicalReport: InstallHubCanonicalReport = {
    reportSource: 'canonical-version',
    treeRevision: 8,
    recordVersionNumber: 5,
    snapshotPayloadHash: 'snapshot-5',
    mappingContentHash: 'mapping-5',
    authoritative: true,
    readyToComplete: true,
    physicalLocations: [],
    electricalNodes: [],
    supplyEdges: [],
    measurementEdges: [],
    meters: [],
    unresolvedRelationships: [],
    assets: [],
    meteringRows: [],
    virtualMeterDefinitions: [],
    readinessIssues: [],
  };
  const html = buildInstallHubReportHtml({
    mode: 'installation-pack',
    detailMode: 'by-zone',
    installation,
    forms: [],
    slices: [],
    resolvedByForm: new Map(),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    electricalMapImages: {
      overviewDataUri: 'data:image/png;base64,b3ZlcnZpZXc=',
      sourceWidth: 2_000,
      sourceHeight: 400,
      overviewWidth: 2_000,
      overviewHeight: 400,
      totalDetailWindows: 30,
      omittedDetailWindows: 28,
      detailTiles: [
        {
          dataUri: 'data:image/png;base64,c2VnbWVudDE=',
          left: 0,
          top: 68,
          width: 1_080,
          height: 300,
          row: 1,
          column: 1,
          rowCount: 1,
          columnCount: 2,
          windowIndex: 1,
          windowCount: 30,
        },
        {
          dataUri: 'data:image/png;base64,c2VnbWVudDI=',
          left: 920,
          top: 68,
          width: 1_080,
          height: 300,
          row: 1,
          column: 2,
          rowCount: 1,
          columnCount: 2,
          windowIndex: 30,
          windowCount: 30,
        },
      ],
    },
    includeIntro: true,
    includeEnd: true,
    generatedLabel: 'Generated 01/08/2026',
    canonicalReport,
  });

  assert.equal(html.match(/data:image\/png;base64,b3ZlcnZpZXc=/g)?.length, 1);
  assert.equal(html.match(/data-map-detail-segment=/g)?.length, 2);
  assert.match(html, /Electrical map detail - row 1 of 1, column 1 of 2/);
  assert.match(html, /Electrical map detail - row 1 of 1, column 2 of 2/);
  assert.match(html, /Source window left 1-1080, top 69-368 of 2000 x 400/);
  assert.match(html, /Source window left 921-2000, top 69-368 of 2000 x 400/);
  assert.match(html, /Window edges retain source overlap; capped sets may omit intermediate windows/);
  assert.doesNotMatch(html, /Adjacent rows and columns overlap/);
  assert.match(html, /Refer to the complete overview for the full topology and legend/);
  assert.match(html, /visual detail pages are capped at 2 representative windows from 30/);
  assert.match(html, /Visual detail page limit reached/);
  assert.match(html, /28 additional map windows/);
  assert.match(html, /data-map-detail-fallback="indexed-hierarchy"/);
  assert.match(html, /Supplied from \/ parent/);
  assert.match(html, /\.electrical-map-detail\{page-break-before:always/);
  assert.match(html, /Solid copper lines show electrical supply/);
});

test('zone details render every electrical node exactly once and retain shared or unknown-zone infrastructure', () => {
  const report: InstallHubCanonicalReport = {
    reportSource: 'canonical-version',
    treeRevision: 4,
    recordVersionNumber: 3,
    snapshotPayloadHash: 'snapshot-3',
    mappingContentHash: 'mapping-3',
    authoritative: true,
    readyToComplete: true,
    physicalLocations: [
      { id: 'zone-a', name: 'Plant room' },
      { id: 'zone-b', name: 'Workshop' },
    ],
    electricalNodes: [
      { id: 'grid', kind: 'GRID', name: 'Incoming grid' },
      { id: 'board-a', kind: 'BOARD', name: 'Main board', physicalLocationId: 'zone-a' },
      { id: 'asset-b', kind: 'SITE_ASSET', name: 'Workshop load', physicalLocationId: 'zone-b' },
      { id: 'unknown-zone-board', kind: 'BOARD', name: 'Unmapped board', physicalLocationId: 'missing-zone' },
    ],
    supplyEdges: [],
    measurementEdges: [],
    meters: [],
    unresolvedRelationships: [],
    assets: [],
    meteringRows: [],
    virtualMeterDefinitions: [],
    readinessIssues: [],
  };
  const html = buildInstallHubReportHtml({
    mode: 'installation-pack',
    detailMode: 'by-zone',
    installation,
    forms: [],
    slices: [],
    resolvedByForm: new Map(),
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    includeIntro: true,
    includeEnd: true,
    generatedLabel: 'Generated 01/08/2026',
    canonicalReport: report,
  });

  assert.match(html, /Shared \/ unassigned electrical infrastructure/);
  for (const node of report.electricalNodes) {
    const marker = `data-electrical-node-id="${node.id}"`;
    assert.equal(html.split(marker).length - 1, 1, `${node.id} should appear in exactly one zone group`);
  }
  assert.equal(html.match(/data-electrical-node-id=/g)?.length, report.electricalNodes.length);
});
