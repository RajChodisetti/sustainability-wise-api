import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  new URL('./schedulerCommercialRetentionService.ts', import.meta.url),
  'utf8',
);

test('a job actor billing-rate override prevents pristine-ledger purge', () => {
  assert.match(service, /schedulerJobActorBillingRateOverrides/);
  assert.match(
    service,
    /from\(schedulerJobActorBillingRateOverrides\)[\s\S]*where\(eq\(schedulerJobActorBillingRateOverrides\.financeId, finance\.id\)\)/,
  );
  assert.match(
    service,
    /if \(billingRateOverride \|\| hourOverride \|\| expense \|\| attachment \|\| invoice\) \{[\s\S]*throw conflict\(PURGE_BLOCKED\)/,
  );
  assert.ok(
    service.indexOf('if (billingRateOverride ||') <
      service.indexOf("set_config('sustainability.scheduler_purge_writer'"),
  );
});
