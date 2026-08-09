import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertInstallHubSiteCodeWriteAllowed,
  formValues,
  deriveInstallHubSiteCode,
  installHubSyncCreatesRecordVersion,
  installationValuesFromPayload,
  parseInstallHubUploadBaseTreeRevision,
  parseInstallHubSyncStage,
  parseInstallHubTreeSchemaMode,
  prepareCanonicalInstallHubWrite,
  validateCanonicalFormContractsForSync,
} from './sync.js';

test('site-code rule matches the canonical eight-initial cross-client fixtures', () => {
  assert.deepEqual([
    deriveInstallHubSiteCode('Warehouse'),
    deriveInstallHubSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf'),
    deriveInstallHubSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel'),
    deriveInstallHubSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India'),
  ], ['W', 'ABCDEFG', 'ABCDEFGH', 'ABCDEFGH']);
});

test('site-code write policy grandfathers only the exact authoritative legacy value', () => {
  const isSiteCodeError = (error: unknown) => Boolean(
    error
    && typeof error === 'object'
    && 'detail' in error
    && typeof error.detail === 'string'
    && error.detail.startsWith('installation.siteCode must be 1-16')
  );
  const historical = 'Legacy Site Code / 2024';
  assert.doesNotThrow(() => assertInstallHubSiteCodeWriteAllowed(historical, historical));
  const paddedHistorical = ` ${historical} `;
  assert.doesNotThrow(() => (
    assertInstallHubSiteCodeWriteAllowed(paddedHistorical, paddedHistorical)
  ));
  assert.doesNotThrow(() => assertInstallHubSiteCodeWriteAllowed('SYD-WH1', historical));
  assert.throws(
    () => assertInstallHubSiteCodeWriteAllowed(historical),
    isSiteCodeError,
  );
  assert.throws(
    () => assertInstallHubSiteCodeWriteAllowed('Different Legacy Code', historical),
    isSiteCodeError,
  );
  assert.throws(
    () => assertInstallHubSiteCodeWriteAllowed(historical, paddedHistorical),
    isSiteCodeError,
  );
});

test('upload revision parser supports an explicit compatibility window', () => {
  assert.equal(parseInstallHubUploadBaseTreeRevision(undefined, false), undefined);
  assert.equal(parseInstallHubUploadBaseTreeRevision(7, true), 7);
  assert.throws(
    () => parseInstallHubUploadBaseTreeRevision(undefined, true),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'detail' in error
      && error.detail === 'client_upgrade_required: upload baseTreeRevision'
    ),
  );
  for (const required of [false, true]) {
    for (const invalid of [null, '', '7', ' ', 1.5, -1]) {
      assert.throws(
        () => parseInstallHubUploadBaseTreeRevision(invalid, required),
        (error: unknown) => Boolean(
          error
          && typeof error === 'object'
          && 'detail' in error
          && error.detail === 'baseTreeRevision must be a non-negative integer'
        ),
      );
    }
  }
});
import { normalizeInstallationTreeV2 } from './canonical.js';
import {
  assertCompletedFormsImmutable,
  retainCompletedFormsDuringMetadata,
} from './treeService.js';
import {
  assertInstallationAccess,
  assertInstallationDeletionAccess,
  shouldPurgeQuery,
} from './helpers.js';

test('InstallHub sync maps canonical fields and binds new records to the actor', () => {
  const values = installationValuesFromPayload({
    id: 'installation-1',
    clientName: 'Example Client',
    siteName: 'Example Site',
    siteAddress: '42 Example Road',
    inspectorName: 'Installer One',
    auditDate: '2026-07-22',
    status: 'Completed',
    createdByUserId: 'spoofed-user',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  }, {
    userId: 'authenticated-user',
    role: 'inspector',
  });

  assert.equal(values.id, 'installation-1');
  assert.equal(values.clientName, 'Example Client');
  assert.equal(values.status, 'Completed');
  assert.equal(values.createdByUserId, 'authenticated-user');
  assert.equal(values.syncStatus, 'synced');
});

test('InstallHub sync rejects an incomplete installation payload', () => {
  assert.throws(
    () => installationValuesFromPayload({
      id: 'installation-1',
      siteName: 'Missing required values',
    }, {
      userId: 'authenticated-user',
      role: 'inspector',
    }),
    (error: unknown) => (
      error instanceof Error &&
      'detail' in error &&
      error.detail === 'clientName is required'
    ),
  );
});

test('InstallHub access permits owner, assignee and admin but rejects unrelated inspectors', () => {
  const installation = {
    createdByUserId: 'owner',
    assignedInspectorUserId: 'assignee',
  };
  const actor = (userId: string, role: 'inspector' | 'admin') => ({
    userId,
    app: 'installhub' as const,
    role,
    authType: 'jwt' as const,
  });
  assert.doesNotThrow(() => assertInstallationAccess(installation, actor('owner', 'inspector')));
  assert.doesNotThrow(() => assertInstallationAccess(installation, actor('assignee', 'inspector')));
  assert.doesNotThrow(() => assertInstallationAccess(installation, actor('admin-user', 'admin')));
  assert.throws(() => assertInstallationAccess(installation, actor('other', 'inspector')));
});

test('InstallHub Cloud Backup deletion is limited to the creator or elevated roles', () => {
  const installation = {
    createdByUserId: 'owner',
    assignedInspectorUserId: 'assignee',
  };
  const actor = (userId: string, role: 'inspector' | 'admin') => ({
    userId,
    app: 'installhub' as const,
    role,
    authType: 'jwt' as const,
  });
  assert.doesNotThrow(() =>
    assertInstallationDeletionAccess(installation, actor('owner', 'inspector')));
  assert.doesNotThrow(() =>
    assertInstallationDeletionAccess(installation, actor('admin-user', 'admin')));
  assert.throws(() =>
    assertInstallationDeletionAccess(installation, actor('assignee', 'inspector')));
  assert.throws(() =>
    assertInstallationDeletionAccess(installation, actor('other', 'inspector')));
});

test('InstallHub purge query accepts only explicit truthy controls', () => {
  assert.equal(shouldPurgeQuery(), false);
  assert.equal(shouldPurgeQuery({ purge: false }), false);
  assert.equal(shouldPurgeQuery({ purge: 'false' }), false);
  assert.equal(shouldPurgeQuery({ purge: true }), true);
  assert.equal(shouldPurgeQuery({ purge: 'YES' }), true);
});

test('InstallHub sync accepts staged pushes and keeps an absent stage backward compatible', () => {
  assert.equal(parseInstallHubSyncStage('metadata'), 'metadata');
  assert.equal(parseInstallHubSyncStage('complete'), 'complete');
  assert.equal(parseInstallHubSyncStage(undefined), undefined);
  assert.equal(installHubSyncCreatesRecordVersion('metadata'), false);
  assert.equal(installHubSyncCreatesRecordVersion('complete'), true);
  assert.equal(installHubSyncCreatesRecordVersion(undefined), true);
});

test('InstallHub sync rejects unknown stages before persistence', () => {
  assert.throws(
    () => parseInstallHubSyncStage('uploading'),
    (error: unknown) => (
      error instanceof Error &&
      'detail' in error &&
      error.detail === 'syncStage must be metadata or complete'
    ),
  );
});

test('metadata retains an already-completed form only when every immutable field matches', () => {
  const completed = {
    id: 'form-1',
    installationId: 'installation-1',
    formType: 'generic',
    schemaVersion: 2,
    status: 'Completed',
    zoneId: 'zone-1',
    answers: { result: 'accepted' },
    attachments: [{
      id: 'attachment-1',
      uri: '/v1/installhub/photos/photo-1',
    }],
    completedAt: '2026-08-02T01:00:00.000Z',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T01:00:00.000Z',
  };
  const staged = {
    ...completed,
    status: 'Draft',
    completedAt: null,
    updatedAt: '2026-08-02T02:00:00.000Z',
  };

  const retained = retainCompletedFormsDuringMetadata({
    existing: [completed],
    incoming: [staged],
  });
  assert.equal(retained[0], completed);
  assert.doesNotThrow(() => assertCompletedFormsImmutable({
    existing: [completed],
    incoming: retained,
  }));

  const changed = retainCompletedFormsDuringMetadata({
    existing: [completed],
    incoming: [{ ...staged, answers: { result: 'changed' } }],
  });
  assert.equal(changed[0]?.status, 'Draft');
  assert.throws(
    () => assertCompletedFormsImmutable({ existing: [completed], incoming: changed }),
    /COMPLETED_FORM_IMMUTABLE:form-1/,
  );
});

test('InstallHub sync fails closed for every declared non-v2 or mismatched tree schema', () => {
  assert.equal(parseInstallHubTreeSchemaMode({ installation: {} }), 1);
  assert.equal(parseInstallHubTreeSchemaMode({ installation: { treeSchemaVersion: 1 } }), 1);
  assert.equal(parseInstallHubTreeSchemaMode({
    treeSchemaVersion: 2,
    installation: { treeSchemaVersion: 2 },
  }), 2);
  assert.equal(parseInstallHubTreeSchemaMode({
    treeSchemaVersion: 2,
    installation: {},
  }), 2);

  for (const payload of [
    { treeSchemaVersion: 3, installation: { treeSchemaVersion: 3 } },
    { installation: { treeSchemaVersion: 3 } },
    { installation: { treeSchemaVersion: '2' } },
    { treeSchemaVersion: 2, installation: { treeSchemaVersion: 3 } },
    { treeSchemaVersion: 3, installation: { treeSchemaVersion: 2 } },
    { treeSchemaVersion: '2', installation: { treeSchemaVersion: 2 } },
    { treeSchemaVersion: 2, installation: { treeSchemaVersion: '2' } },
  ]) {
    assert.throws(
      () => parseInstallHubTreeSchemaMode(payload),
      (error: unknown) => (
        error instanceof Error
        && 'statusCode' in error
        && error.statusCode === 400
        && 'detail' in error
        && error.detail === 'unsupported_tree_schema'
      ),
    );
  }
});

function freshCanonicalWrite(
  installationId: string,
  installation: Record<string, unknown>,
  baseTreeRevision: number | undefined = 0,
) {
  return {
    syncStage: 'metadata' as const,
    treeSchemaVersion: 2,
    ...(baseTreeRevision === undefined ? {} : { baseTreeRevision }),
    installation: {
      id: installationId,
      treeSchemaVersion: 2,
      clientName: 'Fresh Client',
      siteName: 'Fresh Site',
      siteAddress: '1 New Road',
      inspectorName: 'Installer One',
      auditDate: '2026-08-02',
      status: 'Draft',
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      ...installation,
    },
    gridSupplies: [{
      id: `grid_${installationId}_primary`,
      installationId,
      name: 'Grid supply',
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

test('canonical create preparation accepts exact portal and mobile first-sync shapes', () => {
  const blankOptional = prepareCanonicalInstallHubWrite(freshCanonicalWrite('blank-optional', {
    siteName: '   ',
    timezone: 'Invalid/Timezone',
    externalKey: null,
    siteCode: null,
    treeRevision: 0,
    recordVersionNumber: 0,
  }), undefined, 'ih_blank_optional');
  const normalizedBlankOptional = normalizeInstallationTreeV2(blankOptional);
  assert.equal(blankOptional.installation?.siteName, 'Untitled installation');
  assert.equal(normalizedBlankOptional.installation.timezone, 'Australia/Sydney');

  const portal = prepareCanonicalInstallHubWrite(freshCanonicalWrite('portal-new', {
    externalKey: null,
    siteCode: 'FRESH-1',
    timezone: 'Australia/Sydney',
    treeRevision: 0,
    recordVersionNumber: 0,
  }), undefined, 'ih_portal_server');
  const normalizedPortal = normalizeInstallationTreeV2(portal);
  assert.equal(normalizedPortal.installation.externalKey, 'ih_portal_server');
  assert.equal(normalizedPortal.installation.treeRevision, 0);
  assert.equal(normalizedPortal.installation.recordVersionNumber, 0);

  // Exact first-sync omissions from mobile buildBackupPayload for an imported
  // copy: local identity, no nested tree revision, and null record version.
  const mobile = prepareCanonicalInstallHubWrite(freshCanonicalWrite('mobile-copy', {
    externalKey: 'local:mobile-copy',
    siteCode: undefined,
    timezone: 'Australia/Sydney',
    recordVersionNumber: null,
  }, undefined), undefined, 'ih_mobile_server');
  const normalizedMobile = normalizeInstallationTreeV2(mobile);
  assert.equal(normalizedMobile.installation.externalKey, 'ih_mobile_server');
  assert.equal(normalizedMobile.installation.siteCode, 'FS');
  assert.equal(normalizedMobile.installation.treeRevision, 0);
  assert.equal(normalizedMobile.installation.recordVersionNumber, 0);

  const importedWithSourceIdentity = prepareCanonicalInstallHubWrite(
    freshCanonicalWrite('imported-copy', {
      externalKey: 'ih_source-installation',
      siteCode: 'COPY',
      timezone: 'Australia/Sydney',
      treeRevision: 0,
      recordVersionNumber: 0,
    }),
    undefined,
    'ih_fresh-copy-identity',
  );
  assert.equal(
    normalizeInstallationTreeV2(importedWithSourceIdentity).installation.externalKey,
    'ih_fresh-copy-identity',
  );
});

test('canonical update preparation hydrates server metadata but preserves top-level CAS', () => {
  const staleMobileWrite = freshCanonicalWrite('mobile-existing', {
    externalKey: 'local:mobile-existing',
    siteCode: null,
    timezone: null,
    treeRevision: 42,
    recordVersionNumber: null,
  }, 42);
  const prepared = prepareCanonicalInstallHubWrite(staleMobileWrite, {
    externalKey: 'ih_authoritative',
    siteCode: 'SERVER',
    timezone: 'Australia/Brisbane',
    treeRevision: 43,
    recordVersionNumber: 7,
  }, 'unused');
  const normalized = normalizeInstallationTreeV2(prepared);
  assert.equal(prepared.baseTreeRevision, 42);
  assert.equal(normalized.installation.externalKey, 'ih_authoritative');
  assert.equal(normalized.installation.siteCode, 'SERVER');
  assert.equal(normalized.installation.timezone, 'Australia/Brisbane');
  assert.equal(normalized.installation.treeRevision, 43);
  assert.equal(normalized.installation.recordVersionNumber, 7);

  const historicalCode = 'Legacy Site Code / 2024';
  const historicalPrepared = prepareCanonicalInstallHubWrite(
    freshCanonicalWrite('legacy-existing', {
      externalKey: 'ih_legacy',
      siteCode: null,
      timezone: 'Australia/Brisbane',
      treeRevision: 9,
      recordVersionNumber: 2,
    }, 9),
    {
      externalKey: 'ih_legacy',
      siteCode: historicalCode,
      timezone: 'Australia/Brisbane',
      treeRevision: 9,
      recordVersionNumber: 2,
    },
    'unused',
  );
  assertInstallHubSiteCodeWriteAllowed(
    historicalPrepared.installation?.siteCode,
    historicalCode,
  );
  assert.equal(
    normalizeInstallationTreeV2(historicalPrepared).installation.siteCode,
    historicalCode,
  );

  const whitespaceLocal = prepareCanonicalInstallHubWrite(
    freshCanonicalWrite('mobile-existing', {
      externalKey: '  LOCAL:mobile-existing  ',
      siteCode: null,
      timezone: null,
      treeRevision: 42,
      recordVersionNumber: 7,
    }, 42),
    {
      externalKey: 'ih_authoritative',
      siteCode: 'SERVER',
      timezone: 'Australia/Brisbane',
      treeRevision: 43,
      recordVersionNumber: 7,
    },
    'unused',
  );
  assert.equal(
    normalizeInstallationTreeV2(whitespaceLocal).installation.externalKey,
    'ih_authoritative',
  );

  const importedReplay = prepareCanonicalInstallHubWrite(
    freshCanonicalWrite('mobile-existing', {
      externalKey: 'ih_source_installation',
      siteCode: 'SERVER',
      timezone: 'Australia/Brisbane',
      treeRevision: 0,
      recordVersionNumber: 0,
    }, undefined),
    {
      externalKey: 'ih_authoritative',
      siteCode: 'SERVER',
      timezone: 'Australia/Brisbane',
      treeRevision: 1,
      recordVersionNumber: 0,
    },
    'unused',
  );
  assert.equal(
    normalizeInstallationTreeV2(importedReplay).installation.externalKey,
    'ih_authoritative',
  );

  const identityReplacement = prepareCanonicalInstallHubWrite(
    freshCanonicalWrite('mobile-existing', {
      externalKey: 'ih_source_installation',
      siteCode: 'SERVER',
      timezone: 'Australia/Brisbane',
      treeRevision: 1,
      recordVersionNumber: 0,
    }, 1),
    {
      externalKey: 'ih_authoritative',
      siteCode: 'SERVER',
      timezone: 'Australia/Brisbane',
      treeRevision: 1,
      recordVersionNumber: 0,
    },
    'unused',
  );
  assert.equal(
    normalizeInstallationTreeV2(identityReplacement).installation.externalKey,
    'ih_source_installation',
  );
});

test('canonical update preparation preserves authoritative zone codes for legacy clients', () => {
  const write = {
    ...freshCanonicalWrite('zone-code-existing', {
      externalKey: 'ih_zone_code',
      siteCode: 'ZONE-SITE',
      timezone: 'Australia/Sydney',
      treeRevision: 4,
      recordVersionNumber: 1,
    }, 4),
    zones: [{
      id: 'zone-existing',
      installationId: 'zone-code-existing',
      zoneName: 'Renamed by old client',
      zoneDescription: '',
      photos: [],
    }, {
      id: 'zone-new',
      installationId: 'zone-code-existing',
      zoneName: 'Loading dock',
      zoneDescription: '',
      photos: [],
    }],
  };
  const prepared = prepareCanonicalInstallHubWrite(write, {
    externalKey: 'ih_zone_code',
    siteCode: 'ZONE-SITE',
    timezone: 'Australia/Sydney',
    treeRevision: 4,
    recordVersionNumber: 1,
    zoneCodes: new Map([['zone-existing', 'ORIGINAL-ZONE']]),
  }, 'unused');
  const normalized = normalizeInstallationTreeV2(prepared);
  assert.equal(normalized.zones.find((zone) => zone.id === 'zone-existing')?.zoneCode, 'ORIGINAL-ZONE');
  assert.equal(normalized.zones.find((zone) => zone.id === 'zone-new')?.zoneCode, 'LOADING-DOCK');
});

test('canonical update preparation preserves meter custom names omitted by legacy clients', () => {
  const write = {
    ...freshCanonicalWrite('meter-name-existing', {
      externalKey: 'ih_meter_name',
      siteCode: 'METER-SITE',
      timezone: 'Australia/Sydney',
      treeRevision: 5,
      recordVersionNumber: 2,
    }, 5),
    meterDevices: [{
      id: 'meter-omitted',
    }, {
      id: 'meter-blank',
      customName: '   ',
    }, {
      id: 'meter-explicit',
      customName: 'Client-edited meter',
    }, {
      id: 'meter-new',
    }],
  };
  const prepared = prepareCanonicalInstallHubWrite(write, {
    externalKey: 'ih_meter_name',
    siteCode: 'METER-SITE',
    timezone: 'Australia/Sydney',
    treeRevision: 5,
    recordVersionNumber: 2,
    meterCustomNames: new Map([
      ['meter-omitted', 'Main incomer meter'],
      ['meter-blank', 'Solar export meter'],
      ['meter-explicit', 'Prior meter name'],
    ]),
  }, 'unused');

  assert.equal(prepared.meterDevices?.[0]?.customName, 'Main incomer meter');
  assert.equal(prepared.meterDevices?.[1]?.customName, 'Solar export meter');
  assert.equal(prepared.meterDevices?.[2]?.customName, 'Client-edited meter');
  assert.equal(
    Object.prototype.hasOwnProperty.call(prepared.meterDevices?.[3] ?? {}, 'customName'),
    false,
  );
});

test('canonical write preparation keeps explicit invalid metadata fail-closed', () => {
  assert.throws(
    () => prepareCanonicalInstallHubWrite(
      freshCanonicalWrite('invalid-site-name', {
        siteName: 42,
        treeRevision: 0,
        recordVersionNumber: 0,
      }),
      undefined,
      'ih_invalid_never_persisted',
    ),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'detail' in error
      && error.detail === 'siteName must be a string'
    ),
  );
  for (const installation of [
    { treeRevision: '0', recordVersionNumber: 0 },
    { treeRevision: 0, recordVersionNumber: -1 },
    { treeRevision: 0, recordVersionNumber: 0, timezone: 42 },
    { treeRevision: 0, recordVersionNumber: 0, externalKey: 42 },
  ]) {
    const prepared = prepareCanonicalInstallHubWrite(
      freshCanonicalWrite('invalid-create', installation),
      undefined,
      'ih_invalid_never_persisted',
    );
    assert.throws(() => normalizeInstallationTreeV2(prepared));
  }
});

const completedHoneywellForm = {
  id: 'form-1',
  installationId: 'installation-1',
  formType: 'honeywell-q400',
  schemaVersion: 2,
  status: 'Completed',
  answers: {
    'site.date_time': '2026-07-23T12:00:00.000Z',
    'site.customer_name': 'Example Customer',
    'site.address': '42 Example Road',
    'water.physical_location': 'Plant room',
    'installer.name': 'Installer One',
    'water.serial_number': 'Q400-001',
    'water.activated': 'yes',
    'water.network_registered': 'yes',
  },
  attachments: [],
  createdAt: '2026-07-23T12:00:00.000Z',
  updatedAt: '2026-07-23T12:00:00.000Z',
};

test('InstallHub completion keeps metadata staging immutable while answers and evidence stay optional', () => {
  assert.throws(
    () => formValues(completedHoneywellForm, 'installation-1', undefined, 'metadata'),
    (error: unknown) => (
      error instanceof Error
      && 'detail' in error
      && error.detail === 'metadata_stage_cannot_complete_form'
    ),
  );
  assert.doesNotThrow(
    () => formValues(completedHoneywellForm, 'installation-1'),
  );

  const completed = {
    ...completedHoneywellForm,
    attachments: [
      {
        id: 'lcd-photo',
        slot: 'water.lcd_photo',
        uri: 'https://files.example.test/lcd.jpg',
        mimeType: 'image/jpeg',
        capturedAt: '2026-07-23T12:00:00.000Z',
      },
      {
        id: 'completed-photo',
        slot: 'water.completed_photo',
        uri: 'https://files.example.test/completed.jpg',
        mimeType: 'image/jpeg',
        capturedAt: '2026-07-23T12:00:00.000Z',
      },
    ],
  };
  assert.throws(
    () => formValues(completed, 'installation-1', undefined, 'metadata'),
    (error: unknown) => (
      error instanceof Error
      && 'detail' in error
      && error.detail === 'metadata_stage_cannot_complete_form'
    ),
  );
  const values = formValues(completed, 'installation-1', undefined, 'complete');
  assert.equal(values.attachments.length, 2);
  assert.doesNotThrow(() => formValues(completed, 'installation-1', values, 'metadata'));
});

test('a metadata-stage comms replacement cannot persist completed replacement identity', () => {
  const completedReplacement = {
    ...completedHoneywellForm,
    id: 'comms-replacement-1',
    formType: 'comms-fault',
    meterId: 'meter-1',
    boardId: 'board-1',
    answers: {
      'works.replace_device': 'yes',
      'works.new_device_type': 'A6M',
      'works.new_device_id': 'replacement-serial',
    },
  };
  assert.throws(
    () => formValues(
      completedReplacement,
      'installation-1',
      undefined,
      'metadata',
    ),
    (error: unknown) => (
      error instanceof Error
      && 'detail' in error
      && error.detail === 'metadata_stage_cannot_complete_form'
    ),
  );
  assert.doesNotThrow(() => formValues(
    completedReplacement,
    'installation-1',
    undefined,
    'complete',
  ));
});

function loadOnlyWwForm(status: 'Draft' | 'Completed') {
  const answers: Record<string, string> = {
    'site.date_time': '2026-07-23T12:00:00.000Z',
    'site.customer_name': 'Example Customer',
    'site.address': '42 Example Road',
    'installer.name': 'Installer One',
    'prestart.site_induction': 'yes',
    'prestart.safe_access': 'yes',
    'prestart.correct_ppe': 'yes',
    'prestart.live_points': 'no',
    'prestart.can_isolate': 'yes',
    'prestart.additional_hazards': 'no',
    'prestart.safe_to_proceed': 'yes',
    'auditor.switchboard_name': 'Main Switchboard',
    'auditor.switchboard_location': 'Plant room',
    'auditor.switchboard_type': 'Main switchboard',
    'device.type': 'A3RM',
    'device.number': 'WW-001',
    'device.id': 'A3RM-001',
    'channel.1.load': 'Mains Supply',
    'channel.1.rating': '3000A - 9cm',
    'channel.2.load': 'HVAC',
    'channel.2.rating': '3000A - 20cm',
    'channel.3.load': 'Not Used',
    'commissioning.energised': 'yes',
    'commissioning.leds_visible': 'yes',
    'commissioning.online': 'yes',
    'commissioning.signal_strength': 'Good',
    'commissioning.antenna_type': 'Internal',
    'commissioning.start_complete': 'yes',
    'commissioning.channels_complete': 'yes',
    'commissioning.phase_a_voltage': '230',
    'commissioning.phase_b_voltage': '231',
    'commissioning.phase_c_voltage': '232',
  };
  const requiredPhotoSlots = [
    'auditor.location_before',
    'auditor.sensor_before',
    'auditor.cb_before',
    'auditor.installed_location',
    'auditor.serial_photo',
    'auditor.sensor_installed',
    'auditor.cb_installed',
    'commissioning.start_screenshot',
    'commissioning.channels_screenshot',
    'commissioning.energy_screenshot',
    'commissioning.completed_photos',
  ];
  return {
    id: 'form-legacy-ww',
    installationId: 'installation-1',
    formType: 'ww-installation',
    schemaVersion: 2,
    status,
    answers,
    attachments: requiredPhotoSlots.map((slot, index) => ({
      id: `legacy-ww-photo-${index + 1}`,
      slot,
      uri: `https://files.example.test/legacy-ww-photo-${index + 1}.jpg`,
      mimeType: 'image/jpeg',
      capturedAt: '2026-07-23T12:00:00.000Z',
    })),
    createdAt: '2026-07-23T12:00:00.000Z',
    updatedAt: '2026-07-23T12:00:00.000Z',
  };
}

function currentWwForm() {
  const form = loadOnlyWwForm('Completed');
  form.answers['channel.1.purpose'] = 'Main board supply';
  form.answers['channel.2.purpose'] = 'Sub-circuit / asset';
  form.answers['channel.3.purpose'] = 'Spare / unused';
  delete form.answers['channel.3.load'];
  return form;
}

test('legacy form mapping accepts load-only drafts and completions while preserving Completed immutability', () => {
  const legacyCompleted = loadOnlyWwForm('Completed');
  assert.doesNotThrow(
    () => formValues(legacyCompleted, 'installation-1', undefined, 'complete'),
  );

  const legacyDraft = loadOnlyWwForm('Draft');
  const persistedDraft = formValues(
    legacyDraft,
    'installation-1',
    undefined,
    'metadata',
  );
  assert.equal(persistedDraft.status, 'Draft');
  assert.doesNotThrow(
    () => formValues(legacyCompleted, 'installation-1', persistedDraft, 'complete'),
  );

  const persistedCompleted = formValues(
    currentWwForm(),
    'installation-1',
    undefined,
    'complete',
  );
  const persistedLegacyCompleted = {
    ...persistedCompleted,
    answers: legacyCompleted.answers,
  };
  assert.doesNotThrow(() => formValues(
    legacyCompleted,
    'installation-1',
    persistedLegacyCompleted,
    'complete',
  ));
  assert.throws(
    () => formValues(legacyCompleted, 'installation-1', persistedCompleted, 'complete'),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'detail' in error
      && error.detail === `COMPLETED_FORM_IMMUTABLE:${legacyCompleted.id}`
    ),
  );
  assert.throws(
    () => formValues({
      ...legacyCompleted,
      answers: {
        ...legacyCompleted.answers,
        'channel.1.load': 'Solar PV',
      },
    }, 'installation-1', persistedLegacyCompleted, 'complete'),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'detail' in error
      && error.detail === `COMPLETED_FORM_IMMUTABLE:${legacyCompleted.id}`
    ),
  );
});

test('canonical sync accepts optional load-only completion data across lifecycle contexts', () => {
  const legacyCompleted = loadOnlyWwForm('Completed');
  assert.doesNotThrow(
    () => validateCanonicalFormContractsForSync({
      incoming: [legacyCompleted],
      syncStage: 'complete',
    }),
  );
  assert.doesNotThrow(
    () => validateCanonicalFormContractsForSync({
      incoming: [legacyCompleted],
      existing: [loadOnlyWwForm('Draft')],
      syncStage: 'complete',
    }),
  );
  assert.doesNotThrow(
    () => validateCanonicalFormContractsForSync({
      incoming: [legacyCompleted],
      existing: [{ ...currentWwForm(), id: 'different-completed-form' }],
      syncStage: 'complete',
    }),
  );
  assert.doesNotThrow(() => validateCanonicalFormContractsForSync({
    incoming: [loadOnlyWwForm('Draft')],
    syncStage: 'metadata',
  }));
  assert.doesNotThrow(() => validateCanonicalFormContractsForSync({
    incoming: [legacyCompleted],
    existing: [legacyCompleted],
    syncStage: 'complete',
  }));
});

test('InstallHub form mapping rejects non-array schema-v2 attachments', () => {
  assert.throws(
    () => formValues({
      ...completedHoneywellForm,
      attachments: { slot: 'water.lcd_photo' },
    }, 'installation-1', undefined, 'metadata'),
    (error: unknown) => (
      error instanceof Error
      && 'detail' in error
      && error.detail === 'attachments must be an array'
    ),
  );
});
