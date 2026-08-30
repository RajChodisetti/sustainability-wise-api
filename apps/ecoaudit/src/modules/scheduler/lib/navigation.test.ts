import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SCHEDULER_NAVIGATION_GROUPS,
  schedulerTabAllowsJobCreation,
  schedulerTabFromQuery,
  schedulerTabHref,
  schedulerTabIsAdminOnly,
  schedulerTabShowsUserRatesAction,
} from './navigation';

test('Scheduler sidebar groups expose planning, finance, and inventory sub-tabs', () => {
  assert.deepEqual(
    SCHEDULER_NAVIGATION_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.map((item) => item.label),
    })),
    [
      { label: 'Planning', items: ['Overview', 'Calendar', 'Route planner', 'Deadlines'] },
      { label: 'Finance', items: ['User rates', 'Analytics', 'Summary', 'Bills & expenses', 'Invoices'] },
      { label: 'Inventory', items: ['Dashboard', 'Meter Register'] },
    ],
  );
  assert.equal(schedulerTabIsAdminOnly('calendar'), false);
  assert.equal(schedulerTabIsAdminOnly('users'), true);
  assert.equal(schedulerTabIsAdminOnly('financial-summary'), true);
  assert.equal(schedulerTabIsAdminOnly('meter-register'), true);
  assert.equal(schedulerTabAllowsJobCreation('calendar'), true);
  assert.equal(schedulerTabAllowsJobCreation('inventory'), false);
  assert.equal(schedulerTabAllowsJobCreation('meter-register'), false);
  assert.equal(schedulerTabShowsUserRatesAction('financial-summary'), true);
  assert.equal(schedulerTabShowsUserRatesAction('overview'), false);
});

test('Scheduler query parsing preserves legacy finance links and new inventory views', () => {
  assert.equal(schedulerTabFromQuery('users'), 'users');
  assert.equal(schedulerTabFromQuery('meter-register'), 'meter-register');
  assert.equal(schedulerTabFromQuery('finance', 'invoice-1'), 'invoices');
  assert.equal(schedulerTabFromQuery('finance'), 'financial-summary');
  assert.equal(schedulerTabFromQuery('unknown'), 'calendar');
  assert.equal(schedulerTabHref('meter-register'), '/scheduler?tab=meter-register');
  assert.equal(schedulerTabHref('users'), '/scheduler?tab=users');
});

test('Scheduler navigation lives in the portal sidebar and the page no longer duplicates a tab bar', () => {
  const shell = readFileSync(new URL('../../../components/portal/PortalShell.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../pages/SchedulerPage.tsx', import.meta.url), 'utf8');
  assert.match(shell, /SCHEDULER_NAVIGATION_GROUPS/);
  assert.match(shell, /SchedulerNavigation/);
  assert.doesNotMatch(page, /aria-label="Scheduler views"/);
  assert.match(page, /<SchedulerMeterRegister \/>/);
  assert.match(page, /schedulerTabShowsUserRatesAction\(activeTab\)/);
  assert.match(page, />\s*User rates\s*</);
});

test('Scheduler route planner supports one-time location and free-form Australian origins', () => {
  const workspace = readFileSync(
    new URL('../components/SchedulerRouteWorkspace.tsx', import.meta.url),
    'utf8',
  );
  assert.match(workspace, /Current device location/);
  assert.match(workspace, /Australian address/);
  assert.match(workspace, /new Date\(position\.timestamp\)\.toISOString\(\)/);
  assert.match(workspace, /startingAddress/);
  assert.doesNotMatch(workspace, /originMode === 'address' && !selectedOrigin/);
});

test('Scheduler Inventory stays meter-only and does not expose job creation', () => {
  const page = readFileSync(new URL('../pages/SchedulerPage.tsx', import.meta.url), 'utf8');
  const register = readFileSync(new URL('../components/SchedulerMeterRegister.tsx', import.meta.url), 'utf8');
  assert.match(page, /schedulerTabAllowsJobCreation\(activeTab\)/);
  assert.match(register, /Add meter/);
  assert.match(register, /Custody/);
  assert.doesNotMatch(register, /Device, client, site, address, or job number/);
});
