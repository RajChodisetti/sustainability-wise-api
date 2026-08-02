import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORTAL_APPLICATIONS,
  isPortalApplicationListed,
  visiblePortalApplications,
} from './portalApplications';
import { PORTAL_FEATURES } from './portalFeatures';

test('the portal directory contains every product workspace', () => {
  assert.deepEqual(
    PORTAL_APPLICATIONS.map(({ title, href }) => ({ title, href })),
    [
      { title: 'Eco Audit', href: '/ecoaudit/dashboard' },
      { title: 'Solar Sense', href: '/solar/dashboard' },
      { title: 'Wattwatchers Fleet', href: '/fleet/dashboard' },
      { title: 'Field App Complete', href: '/field' },
    ],
  );
  assert.equal(new Set(PORTAL_APPLICATIONS.map(({ href }) => href)).size, 4);
});

test('Field App Complete remains visible while Solar Sense stays hidden', () => {
  const visible = visiblePortalApplications(
    {
      ecoaudit: true,
      solarsense: true,
      installhub: false,
      wattwatchers: true,
    },
    PORTAL_FEATURES.solarSenseVisible,
  );

  assert.deepEqual(
    visible.map(({ title }) => title),
    ['Eco Audit', 'Wattwatchers Fleet', 'Field App Complete'],
  );
  assert.equal(PORTAL_FEATURES.solarSenseVisible, false);
});

test('all protected workspaces remain registered', () => {
  assert.equal(isPortalApplicationListed('ecoaudit'), true);
  assert.equal(isPortalApplicationListed('solarsense'), true);
  assert.equal(isPortalApplicationListed('installhub'), true);
  assert.equal(isPortalApplicationListed('wattwatchers'), true);
});
