import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SCHEDULER_NAVIGATION_GROUPS,
  schedulerTabFromQuery,
  schedulerTabHref,
  schedulerTabIsAdminOnly,
} from './navigation';

test('Scheduler sidebar groups expose planning, finance, and inventory sub-tabs', () => {
  assert.deepEqual(
    SCHEDULER_NAVIGATION_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.map((item) => item.label),
    })),
    [
      { label: 'Planning', items: ['Overview', 'Calendar', 'My route', 'Deadlines'] },
      { label: 'Finance', items: ['Analytics', 'Summary', 'Bills & expenses', 'Invoices'] },
      { label: 'Inventory', items: ['Dashboard', 'Meter Register'] },
    ],
  );
  assert.equal(schedulerTabIsAdminOnly('calendar'), false);
  assert.equal(schedulerTabIsAdminOnly('financial-summary'), true);
  assert.equal(schedulerTabIsAdminOnly('meter-register'), true);
});

test('Scheduler query parsing preserves legacy finance links and new inventory views', () => {
  assert.equal(schedulerTabFromQuery('meter-register'), 'meter-register');
  assert.equal(schedulerTabFromQuery('finance', 'invoice-1'), 'invoices');
  assert.equal(schedulerTabFromQuery('finance'), 'financial-summary');
  assert.equal(schedulerTabFromQuery('unknown'), 'calendar');
  assert.equal(schedulerTabHref('meter-register'), '/scheduler?tab=meter-register');
});

test('Scheduler navigation lives in the portal sidebar and the page no longer duplicates a tab bar', () => {
  const shell = readFileSync(new URL('../../../components/portal/PortalShell.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../pages/SchedulerPage.tsx', import.meta.url), 'utf8');
  const register = readFileSync(new URL('../components/SchedulerMeterRegister.tsx', import.meta.url), 'utf8');
  assert.match(shell, /SCHEDULER_NAVIGATION_GROUPS/);
  assert.match(shell, /SchedulerNavigation/);
  assert.doesNotMatch(page, /aria-label="Scheduler views"/);
  assert.match(page, /<SchedulerMeterRegister \/>/);
  assert.match(register, /Device, client, site, address, or job number/);
});
