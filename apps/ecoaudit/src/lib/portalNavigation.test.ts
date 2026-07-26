import assert from 'node:assert/strict';
import test from 'node:test';
import { portalAppForPath, safePortalNext } from './portalNavigation';

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
