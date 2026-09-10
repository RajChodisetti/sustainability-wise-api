import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOneDriveBackupPolicy, type OneDriveBackupPolicy } from './configPolicy.js';

const configured = {
  enabled: true,
  backupRequired: true,
  tenantId: 'tenant',
  clientId: 'client',
  clientSecret: 'secret',
  userEmail: 'backups@example.invalid',
  photosFolder: 'SustainabilityWise/photos',
} satisfies OneDriveBackupPolicy;

test('QA may disable an optional OneDrive mirror', () => {
  assert.doesNotThrow(() => assertOneDriveBackupPolicy({
    ...configured,
    enabled: false,
    backupRequired: false,
    tenantId: '',
    clientId: '',
    clientSecret: '',
    userEmail: '',
  }));
});

test('a required OneDrive mirror cannot be disabled', () => {
  assert.throws(
    () => assertOneDriveBackupPolicy({ ...configured, enabled: false }),
    /cannot be required while mirroring is disabled/,
  );
});

test('a required OneDrive mirror fails startup when Graph identity is incomplete', () => {
  assert.throws(
    () => assertOneDriveBackupPolicy({ ...configured, clientSecret: '', userEmail: '' }),
    /AZURE_CLIENT_SECRET, ONEDRIVE_USER_EMAIL/,
  );
});

test('a fully configured required OneDrive mirror passes', () => {
  assert.doesNotThrow(() => assertOneDriveBackupPolicy(configured));
});
