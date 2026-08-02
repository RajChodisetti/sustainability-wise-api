import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formValues,
  installHubSyncCreatesRecordVersion,
  installationValuesFromPayload,
  parseInstallHubSyncStage,
  parseInstallHubTreeSchemaMode,
} from './sync.js';
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

test('InstallHub sync fails closed for every declared non-v2 or mismatched tree schema', () => {
  assert.equal(parseInstallHubTreeSchemaMode({ installation: {} }), 1);
  assert.equal(parseInstallHubTreeSchemaMode({ installation: { treeSchemaVersion: 1 } }), 1);
  assert.equal(parseInstallHubTreeSchemaMode({
    treeSchemaVersion: 2,
    installation: { treeSchemaVersion: 2 },
  }), 2);

  for (const payload of [
    { treeSchemaVersion: 3, installation: { treeSchemaVersion: 3 } },
    { installation: { treeSchemaVersion: 3 } },
    { installation: { treeSchemaVersion: '2' } },
    { treeSchemaVersion: 2, installation: { treeSchemaVersion: 3 } },
    { treeSchemaVersion: 3, installation: { treeSchemaVersion: 2 } },
    { treeSchemaVersion: '2', installation: { treeSchemaVersion: 2 } },
    { treeSchemaVersion: 2, installation: { treeSchemaVersion: '2' } },
    { treeSchemaVersion: 2, installation: {} },
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

test('InstallHub never persists a new Completed form before complete evidence validation', () => {
  assert.throws(
    () => formValues(completedHoneywellForm, 'installation-1', undefined, 'metadata'),
    (error: unknown) => (
      error instanceof Error
      && 'detail' in error
      && error.detail === 'metadata_stage_cannot_complete_form'
    ),
  );
  assert.throws(
    () => formValues(completedHoneywellForm, 'installation-1'),
    (error: unknown) => (
      error instanceof Error
      && 'detail' in error
      && error.detail === 'Completed form requires attachments slot water.lcd_photo'
    ),
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
