import assert from 'node:assert/strict';
import test from 'node:test';
import { appEventSurfaceClass } from './colors';

test('calendar events use one opaque surface with a distinct source border', () => {
  const field = appEventSurfaceClass('installhub');
  const ecoAudit = appEventSurfaceClass('ecoaudit');
  const solarSense = appEventSurfaceClass('solarsense');
  const custom = appEventSurfaceClass('custom');

  assert.match(field, /border-teal-300/);
  assert.match(ecoAudit, /border-sky-300/);
  assert.match(solarSense, /border-amber-300/);
  assert.match(custom, /border-violet-300/);
  for (const surface of [field, ecoAudit, solarSense, custom]) {
    assert.match(surface, /bg-\[var\(--surface\)\]/);
    assert.doesNotMatch(surface, /bg-(?:teal|sky|amber)-500\/15/);
  }
  assert.equal(new Set([field, ecoAudit, solarSense, custom]).size, 4);
});
