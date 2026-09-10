import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  BUSINESS_COMPANY_KEY,
  businessClientMergeLockKeys,
  mayReuseSiteAddressMatch,
  normalizeClientName,
  normalizeFieldExistingDeviceId,
} from './clientSiteMemoryService.js';

test('an explicit fresh-site choice cannot reuse a same-address site record', () => {
  assert.equal(mayReuseSiteAddressMatch({}), true);
  assert.equal(mayReuseSiteAddressMatch({ forceNewSite: false }), true);
  assert.equal(mayReuseSiteAddressMatch({ forceNewSite: true }), false);
});

test('client matching uses one NFKC, whitespace-collapsed, case-insensitive key', () => {
  assert.equal(normalizeClientName('  ABC   Energy  '), 'abc energy');
  assert.equal(normalizeClientName('abc\nenergy'), 'abc energy');
  assert.equal(normalizeClientName('ＡＢＣ　Energy'), 'abc energy');
});

test('overlapping client merges share a per-client advisory lock in stable order', () => {
  const first = businessClientMergeLockKeys('client-b', 'client-a');
  const overlappingSource = businessClientMergeLockKeys('client-a', 'client-c');
  const overlappingTarget = businessClientMergeLockKeys('client-d', 'client-b');

  assert.deepEqual(first, [
    `${BUSINESS_COMPANY_KEY}:merge-client:client-a`,
    `${BUSINESS_COMPANY_KEY}:merge-client:client-b`,
  ]);
  assert.ok(first.some((key) => overlappingSource.includes(key)));
  assert.ok(first.some((key) => overlappingTarget.includes(key)));
});

test('Field replacement plans preserve meter boundaries and enforce the stored aggregate limit', () => {
  assert.equal(
    normalizeFieldExistingDeviceId('  WW-100  \nww-100\n WW-200 '),
    'WW-100\nWW-200',
  );
  assert.equal(normalizeFieldExistingDeviceId('   '), null);
  assert.throws(
    () => normalizeFieldExistingDeviceId('X'.repeat(10_001)),
    (error: unknown) => error instanceof AppError
      && error.detail === 'job.detail.existingDeviceId must contain at most 10000 characters',
  );
});
