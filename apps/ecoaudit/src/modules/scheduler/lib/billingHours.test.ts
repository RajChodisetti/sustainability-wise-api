import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isWholeBillingHoursInput,
  wholeBillingHours,
} from './billingHours';

test('billing hours round to the nearest non-negative whole hour', () => {
  assert.equal(wholeBillingHours(1.49), 1);
  assert.equal(wholeBillingHours(1.5), 2);
  assert.equal(wholeBillingHours(-1), 0);
  assert.equal(wholeBillingHours(Number.NaN), 0);
});

test('billing hours input accepts only empty or non-negative whole-number text', () => {
  assert.equal(isWholeBillingHoursInput(''), true);
  assert.equal(isWholeBillingHoursInput('0'), true);
  assert.equal(isWholeBillingHoursInput('12'), true);
  assert.equal(isWholeBillingHoursInput('01'), true);
  assert.equal(isWholeBillingHoursInput('1.5'), false);
  assert.equal(isWholeBillingHoursInput('-1'), false);
});

test('billing hours use typed digits without wheel or arrow step behavior', async () => {
  const panelSource = await readFile(
    new URL('../components/FinanceSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  const billingInput = panelSource
    .split('id="finance-billable-hours"')[1]
    ?.split('/>')[0] ?? '';

  assert.match(billingInput, /type="text"/);
  assert.match(billingInput, /inputMode="numeric"/);
  assert.doesNotMatch(billingInput, /\b(?:min|step)=/);
  assert.doesNotMatch(panelSource, /addEventListener\(['"]wheel['"]/);
});
