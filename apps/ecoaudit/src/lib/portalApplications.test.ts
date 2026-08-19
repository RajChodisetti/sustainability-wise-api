import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORTAL_APPLICATIONS,
  isPortalApplicationListed,
  portalApplicationIsVisible,
  visiblePortalApplications,
} from './portalApplications';
import { PORTAL_FEATURES } from './portalFeatures';

test('the portal directory contains every product workspace', () => {
  assert.deepEqual(
    PORTAL_APPLICATIONS.map(({ title, href }) => ({ title, href })),
    [
      { title: 'EcoAudit Pro', href: '/ecoaudit/dashboard' },
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
    ['EcoAudit Pro', 'Wattwatchers Fleet', 'Field App Complete'],
  );
  assert.equal(PORTAL_FEATURES.solarSenseVisible, false);
});

test('EcoAudit Pro and Wattwatchers remain visible without app-specific sessions', () => {
  const sessions = {
    ecoaudit: false,
    solarsense: false,
    installhub: false,
    wattwatchers: false,
  };
  const visible = visiblePortalApplications(sessions, PORTAL_FEATURES.solarSenseVisible);

  assert.deepEqual(
    visible.map(({ title }) => title),
    ['EcoAudit Pro', 'Wattwatchers Fleet', 'Field App Complete'],
  );
  assert.equal(portalApplicationIsVisible('ecoaudit', sessions, false), true);
  assert.equal(portalApplicationIsVisible('wattwatchers', sessions, false), true);
  assert.equal(portalApplicationIsVisible('installhub', sessions, false), true);
  assert.equal(portalApplicationIsVisible('solarsense', sessions, false), false);
});

test('all protected workspaces remain registered', () => {
  assert.equal(isPortalApplicationListed('ecoaudit'), true);
  assert.equal(isPortalApplicationListed('solarsense'), true);
  assert.equal(isPortalApplicationListed('installhub'), true);
  assert.equal(isPortalApplicationListed('wattwatchers'), true);
});
