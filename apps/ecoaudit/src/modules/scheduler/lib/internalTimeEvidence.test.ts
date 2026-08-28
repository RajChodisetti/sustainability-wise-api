import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('finance summary keeps job actor rates behind one expandable action', async () => {
  const panelSource = await readFile(
    new URL('../components/FinanceSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  const domainSource = await readFile(
    new URL('../types/domain.ts', import.meta.url),
    'utf8',
  );

  assert.match(panelSource, /Edit job rates/);
  assert.match(panelSource, /aria-expanded=\{ratesOpen\}/);
  assert.match(panelSource, /Save job rate/);
  assert.match(panelSource, /Use default/);
  assert.match(panelSource, /actor\.defaultBillingRate/);
  assert.match(panelSource, /actor\.effectiveBillingRate/);
  assert.doesNotMatch(panelSource, /Internal calculation/);
  assert.doesNotMatch(panelSource, /Billing details/);
  assert.doesNotMatch(panelSource, /resting|inactive time/i);
  assert.doesNotMatch(domainSource, /restingHours|restingMilliseconds/);
});

test('job overrides and canonical user defaults use separate mutation paths', async () => {
  const [panelSource, usersSource, hooksSource, domainSource] = await Promise.all([
    readFile(new URL('../components/FinanceSettingsPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/SchedulerUsersWorkspace.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../hooks/useScheduler.ts', import.meta.url), 'utf8'),
    readFile(new URL('../types/domain.ts', import.meta.url), 'utf8'),
  ]);
  const overrideHookStart = hooksSource.indexOf('export function useUpdateSchedulerActorBillingRateOverride');
  const overrideHookEnd = hooksSource.indexOf('export function useSchedulerPortfolioSummary', overrideHookStart);
  const overrideHookSource = hooksSource.slice(overrideHookStart, overrideHookEnd);

  assert.ok(overrideHookStart >= 0);
  assert.ok(overrideHookEnd > overrideHookStart);
  assert.match(panelSource, /useUpdateSchedulerActorBillingRateOverride/);
  assert.doesNotMatch(panelSource, /useUpdatePortalUserBillingRate/);
  assert.match(usersSource, /useUpdatePortalUserBillingRate/);
  assert.doesNotMatch(usersSource, /useUpdateSchedulerActorBillingRateOverride/);
  assert.match(overrideHookSource, /schedulerKeys\.finance\(\)/);
  assert.doesNotMatch(overrideHookSource, /schedulerKeys\.assignees\(\)/);
  assert.match(domainSource, /defaultBillingRate: number \| null/);
  assert.match(domainSource, /billingRateOverride: number \| null/);
  assert.match(domainSource, /effectiveBillingRate: number \| null/);
  assert.match(domainSource, /billingRateSource: 'job_override' \| 'global_default' \| 'missing'/);
});
