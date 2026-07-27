import assert from 'node:assert/strict';
import test from 'node:test';
import { PORTAL_APPLICATIONS, isPortalApplicationListed } from './portalApplications';
import { PORTAL_FEATURES } from './portalFeatures';

test('the unified portal lists every required application destination', () => {
  assert.deepEqual(
    PORTAL_APPLICATIONS.map(({ title, href }) => ({ title, href })),
    [
      { title: 'Eco Audit', href: '/ecoaudit/dashboard' },
      { title: 'Solar Sense', href: '/solar/dashboard' },
      { title: 'Wattwatchers Fleet', href: '/fleet/dashboard' },
      { title: 'Field App', href: '/field' },
      { title: 'Scheduler', href: '/scheduler' },
    ],
  );
  assert.equal(new Set(PORTAL_APPLICATIONS.map(({ href }) => href)).size, 5);
});

test('all protected workspaces are listed and Solar Sense is enabled', () => {
  assert.equal(isPortalApplicationListed('ecoaudit'), true);
  assert.equal(isPortalApplicationListed('solarsense'), true);
  assert.equal(isPortalApplicationListed('installhub'), true);
  assert.equal(isPortalApplicationListed('wattwatchers'), true);
  assert.equal(PORTAL_FEATURES.solarSenseVisible, true);
});
