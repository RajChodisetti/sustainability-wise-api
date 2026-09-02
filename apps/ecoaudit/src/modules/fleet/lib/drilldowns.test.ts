import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installHubDrilldownHref,
  placementSourceLabel,
  safeInstallHubPath,
} from './drilldowns';

test('Field drilldowns keep only same-origin InstallHub destinations', () => {
  assert.equal(
    safeInstallHubPath('/installhub/installations/installation-1/data#canonical-electrical-map'),
    '/installhub/installations/installation-1/data#canonical-electrical-map',
  );
  assert.equal(safeInstallHubPath('/fleet/devices/device-1'), null);
  assert.equal(safeInstallHubPath('https://example.com/installhub/steal'), null);
});

test('Field drilldowns require portal login when no Field session is active', () => {
  const path = '/installhub/installations/installation-1/report';
  assert.equal(installHubDrilldownHref(path, true), path);
  assert.equal(
    installHubDrilldownHref(path, false),
    `/login?next=${encodeURIComponent(path)}`,
  );
});

test('Field form references use the same protected deep-link boundary', () => {
  const path = '/installhub/installations/installation-1/forms/form-2';
  assert.equal(installHubDrilldownHref(path, true), path);
  assert.equal(
    installHubDrilldownHref(path, false),
    `/login?next=${encodeURIComponent(path)}`,
  );
});

test('placement labels keep source provenance explicit', () => {
  assert.equal(placementSourceLabel('field_installation'), 'Field installation');
  assert.equal(placementSourceLabel('maas_assignment'), 'MaaS assignment');
  assert.equal(placementSourceLabel('meter_register'), 'Meter Register');
});
