import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_COMPANY_KEY,
  businessClientMergeLockKeys,
  normalizeClientName,
} from './clientSiteMemoryService.js';

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
