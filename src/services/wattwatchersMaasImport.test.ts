import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeMaasWorkbook,
  normalizeMaasWorkbookRow,
  type MaasWorkbookRow,
} from './wattwatchersMaasImport.js';

function row(overrides: Partial<MaasWorkbookRow> = {}): MaasWorkbookRow {
  return {
    sourceRow: 2,
    customerName: 'Hastings Deering - 25 Wishart Road, Wishart NT 0822',
    clientName: 'Eutility',
    siteAddress: '25 Wishart Road Wishart, NT, 0822',
    jobCompletionDate: '2025-12-08',
    maasStartDate: null,
    existingDeviceId: 'DD93710148684',
    newDeviceId: null,
    notes: null,
    ...overrides,
  };
}

test('normalizes embedded customer addresses and account ownership without losing source facts', () => {
  const normalized = normalizeMaasWorkbookRow(row());
  assert.equal(normalized.customerName, 'Hastings Deering (Australia) Limited');
  assert.equal(normalized.fleetAccountCode, 'eutility');
  assert.equal(normalized.siteAddress, '25 Wishart Road Wishart, NT 0822');
  assert.equal(normalized.siteState, 'NT');
  assert.equal(normalized.sitePostcode, '0822');
  assert.equal(normalized.jobCompletionDate, '2025-12-08');
  assert.equal(normalized.maasStartDate, null);
  assert.equal(normalized.currentExternalDeviceId, 'DD93710148684');
  assert.ok(normalized.siteAddressFingerprint?.match(/^[0-9a-f]{64}$/u));
});

test('uses the new device as current and preserves both sides of replacement history', () => {
  const normalized = normalizeMaasWorkbookRow(row({
    sourceRow: 4,
    existingDeviceId: 'DD13710148641',
    newDeviceId: 'DD23710158376',
  }));
  assert.equal(normalized.existingDeviceId, 'DD13710148641');
  assert.equal(normalized.newDeviceId, 'DD23710158376');
  assert.equal(normalized.currentExternalDeviceId, 'DD23710158376');
});

test('keeps an unavailable site truly unknown while retaining the available note', () => {
  const normalized = normalizeMaasWorkbookRow(row({
    sourceRow: 73,
    customerName: 'Salmon Earthmoving',
    siteAddress: null,
    jobCompletionDate: null,
    maasStartDate: '2026-06-24',
    existingDeviceId: null,
    newDeviceId: 'DD83710160857',
    notes: 'Third-party installation by the client',
  }));
  assert.equal(normalized.fallbackBusinessSiteId, null);
  assert.equal(normalized.siteAddress, null);
  assert.equal(normalized.deviceLabel, 'Salmon Earthmoving - Site unknown');
  assert.equal(normalized.notes, 'Third-party installation by the client');
});

test('maps SUMS and RAM to the MaaS account records and rejects duplicate device IDs', () => {
  const sums = row({ sourceRow: 12, clientName: 'SUMS', existingDeviceId: 'DDF3710148712' });
  const ram = row({ sourceRow: 78, clientName: 'RAM', existingDeviceId: 'DDF3710140597' });
  assert.equal(normalizeMaasWorkbookRow(sums).fleetAccountCode, 'sums-for-sustainability-wise');
  assert.equal(normalizeMaasWorkbookRow(ram).fleetAccountCode, 'ram-for-sustainability-wise');
  assert.throws(() => normalizeMaasWorkbook([
    sums,
    { ...ram, existingDeviceId: sums.existingDeviceId },
  ]), /Duplicate device ID/);
});
