import assert from 'node:assert/strict';
import test from 'node:test';
import { appEventSurfaceClass } from './colors';

test('each product has one stable calendar background', () => {
  const field = appEventSurfaceClass('installhub');
  const ecoAudit = appEventSurfaceClass('ecoaudit');
  const solarSense = appEventSurfaceClass('solarsense');

  assert.match(field, /bg-teal-500\/15/);
  assert.match(ecoAudit, /bg-sky-500\/15/);
  assert.match(solarSense, /bg-amber-500\/15/);
  assert.equal(new Set([field, ecoAudit, solarSense]).size, 3);
});
