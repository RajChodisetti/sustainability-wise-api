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
  visibleInstallHubReportSectionIndexes,
  type InstallHubReportForm,
  type InstallHubReportInstallation,
  type InstallHubReportPhoto,
  type ResolvedInstallHubFormPhoto,
} from './reportHtml.js';
import {
  INSTALLHUB_REPORT_DEFINITIONS,
  INSTALLHUB_REPORT_DEFINITION_BY_TYPE,
  INSTALLHUB_REPORT_MANIFEST_VERSION,
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

test('missing backed evidence fails with the exact attachment identities', () => {
  const reportForm = form({
    attachments: [
      { slot: 'water.lcd_photo', uri: 'file:///lcd.jpg' },
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
      'site.date_time': '2026-07-23 10:30',
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
  assert.match(html, /<span>125<\/span>Evidence photos/);
  assert.match(html, /InstallHub report manifest v1/);
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
