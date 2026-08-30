import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('InstallHub routes are grouped under the Field App Complete navigation scope', () => {
  assert.equal(portalNavigationScopeForPath('/field'), 'field');
  assert.equal(portalNavigationScopeForPath('/installhub/dashboard'), 'field');
  assert.equal(portalNavigationScopeForPath('/installhub/route'), 'field');
  assert.equal(portalNavigationScopeForPath('/installhub/installations/installation-1'), 'field');
  assert.equal(portalNavigationScopeForPath('/ecoaudit/audits'), 'ecoaudit');
  assert.equal(portalNavigationScopeForPath('/fleet/devices'), 'fleet');
  assert.equal(portalNavigationScopeForPath('/scheduler'), 'portal');
});

test('Field App exposes its own route planner without importing the Scheduler workspace', () => {
  const shell = readFileSync(
    new URL('../components/portal/PortalShell.tsx', import.meta.url),
    'utf8',
  );
  const routeEntry = readFileSync(
    new URL('../app/(portal)/installhub/(app)/route/page.tsx', import.meta.url),
    'utf8',
  );
  const routePage = readFileSync(
    new URL('../modules/installhub/pages/RoutePage.tsx', import.meta.url),
    'utf8',
  );
  const routeApi = readFileSync(
    new URL('../modules/installhub/api/routing.ts', import.meta.url),
    'utf8',
  );

  assert.match(shell, /href: '\/installhub\/route', label: 'Route planner'/);
  assert.match(routeEntry, /InstallHubRoutePage/);
  assert.match(routePage, /useInstallHubRouteSuggestion/);
  assert.match(routePage, /Current device location/);
  assert.match(routePage, /Australian address/);
  assert.match(routePage, /new Date\(position\.timestamp\)\.toISOString\(\)/);
  assert.match(routePage, /startingAddress/);
  assert.doesNotMatch(routePage, /originMode === 'address' && !selectedOrigin/);
  assert.doesNotMatch(routePage, /SchedulerRouteWorkspace|modules\/scheduler/);
  assert.doesNotMatch(routePage, /assigneeFieldUserId|Technician/);
  assert.match(routePage, /does not provide maps or navigation/);
  assert.match(routeApi, /'\/v1\/installhub\/route-suggestions'/);
  assert.match(routeApi, /installHubRequest/);
  assert.doesNotMatch(routeApi, /portalRequest|modules\/scheduler|assigneeFieldUserId/);
});

test('Field App exposes its own inventory navigation and custody-claim workflow', () => {
  const shell = readFileSync(
    new URL('../components/portal/PortalShell.tsx', import.meta.url),
    'utf8',
  );
  const inventoryEntry = readFileSync(
    new URL('../app/(portal)/installhub/(app)/inventory/page.tsx', import.meta.url),
    'utf8',
  );
  const inventoryPage = readFileSync(
    new URL('../modules/installhub/pages/InventoryPage.tsx', import.meta.url),
    'utf8',
  );
  const inventoryApi = readFileSync(
    new URL('../modules/installhub/api/inventory.ts', import.meta.url),
    'utf8',
  );
  const scanner = readFileSync(
    new URL('../modules/installhub/components/ScannerInput.tsx', import.meta.url),
    'utf8',
  );

  assert.match(shell, /href: '\/installhub\/inventory', label: 'Inventory'/);
  assert.match(inventoryEntry, /InstallHubInventoryPage/);
  assert.match(inventoryPage, /My inventory/);
  assert.match(inventoryPage, /Company inventory/);
  assert.match(inventoryPage, /Scan barcode/);
  assert.match(inventoryPage, /Enter manually/);
  assert.match(inventoryPage, /Confirm meter/);
  assert.match(inventoryPage, /autoOpenKey/);
  assert.match(inventoryPage, /setPendingScannedId\(''\)/);
  assert.match(inventoryPage, /debouncedSearch/);
  assert.match(inventoryApi, /query\.set\('q', normalizedSearch\)/);
  assert.match(inventoryApi, /'\/v1\/installhub\/inventory\/meters\/claim-by-device'/);
  assert.match(scanner, /onScanResult/);
  assert.match(scanner, /autoOpenKey/);
  assert.match(scanner, /acquiredStream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.doesNotMatch(inventoryPage, /modules\/scheduler|portalRequest/);
  assert.doesNotMatch(inventoryApi, /modules\/scheduler|portalRequest/);
});
