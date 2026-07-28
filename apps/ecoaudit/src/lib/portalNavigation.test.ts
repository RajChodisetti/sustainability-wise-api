import assert from 'node:assert/strict';
import test from 'node:test';
import {
  portalAppForPath,
  portalLoginRedirectPath,
  portalNavigationScopeForPath,
  safePortalLoginNext,
  safePortalNext,
} from './portalNavigation';

test('safePortalNext accepts and normalizes local portal paths', () => {
  assert.equal(safePortalNext('/solar/sites?tab=photos#latest'), '/solar/sites?tab=photos#latest');
  assert.equal(safePortalNext('/ecoaudit/../solar/dashboard'), '/solar/dashboard');
  assert.equal(safePortalNext('/'), '/');
});

test('safePortalNext rejects absolute, network and unsafe encoded paths', () => {
  const unsafe = [
    'https://example.com/solar',
    '//example.com/solar',
    '/\\example.com/solar',
    '/%5cexample.com/solar',
    '/%255cexample.com/solar',
    '/%2f%2fexample.com/solar',
    '/%252f%252fexample.com/solar',
    '/%252e%252e%252f%252fexample.com/solar',
    '/%0d%0aLocation:%20https://example.com',
    '/%250d%250aLocation:%20https://example.com',
    `/solar/\u0085dashboard`,
  ];

  for (const value of unsafe) {
    assert.equal(safePortalNext(value), '/', value);
  }
});

test('portalAppForPath selects only app-local targets', () => {
  assert.equal(portalAppForPath('/ecoaudit/audits'), 'ecoaudit');
  assert.equal(portalAppForPath('/solar/sites'), 'solarsense');
  assert.equal(portalAppForPath('/installhub/installations'), 'installhub');
  assert.equal(portalAppForPath('/fleet/devices'), 'wattwatchers');
  assert.equal(portalAppForPath('/scheduler'), null);
  assert.equal(portalAppForPath('//example.com/solar'), null);
});

test('safePortalLoginNext preserves deep links and rejects auth loops', () => {
  assert.equal(
    safePortalLoginNext('/installhub/admin/users?view=active', '/installhub'),
    '/installhub/admin/users?view=active',
  );
  assert.equal(safePortalLoginNext('/login', '/installhub'), '/installhub');
  assert.equal(safePortalLoginNext('/installhub/login', '/installhub'), '/installhub');
  assert.equal(safePortalLoginNext('/solar/signup', '/solar'), '/solar');
});

test('portalLoginRedirectPath sends legacy app login URLs to the canonical login safely', () => {
  assert.equal(
    portalLoginRedirectPath('/installhub/admin/users', '/installhub'),
    '/login?next=%2Finstallhub%2Fadmin%2Fusers',
  );
  assert.equal(
    portalLoginRedirectPath('https://example.com/steal-session', '/installhub'),
    '/login?next=%2Finstallhub',
  );
  assert.equal(
    portalLoginRedirectPath(
      ['/ecoaudit/dashboard', '/solar/dashboard'],
      '/ecoaudit',
    ),
    '/login?next=%2Fecoaudit%2Fdashboard',
  );
});

test('InstallHub is grouped under the Field App navigation scope', () => {
  assert.equal(portalNavigationScopeForPath('/field'), 'field');
  assert.equal(portalNavigationScopeForPath('/installhub/dashboard'), 'field');
  assert.equal(portalNavigationScopeForPath('/installhub/installations/installation-1'), 'field');
  assert.equal(portalNavigationScopeForPath('/ecoaudit/audits'), 'ecoaudit');
  assert.equal(portalNavigationScopeForPath('/fleet/devices'), 'fleet');
  assert.equal(portalNavigationScopeForPath('/scheduler'), 'portal');
});
