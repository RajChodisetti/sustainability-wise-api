import assert from 'node:assert/strict';
import test from 'node:test';
import { appEventSurfaceClass, calendarEventSurfaceClass } from './colors';

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

test('calendar status surfaces highlight in-progress work blue and completed work green', () => {
  const inProgress = calendarEventSurfaceClass('installhub', 'in_progress');
  const completed = calendarEventSurfaceClass('installhub', 'completed');

  assert.match(inProgress, /border-blue-500/);
  assert.match(inProgress, /bg-blue-100/);
  assert.match(completed, /border-emerald-600/);
  assert.match(completed, /bg-emerald-100/);
  assert.equal(
    calendarEventSurfaceClass('installhub', 'default'),
    appEventSurfaceClass('installhub'),
  );
  assert.equal(
    calendarEventSurfaceClass('installhub', 'overdue'),
    appEventSurfaceClass('installhub'),
  );
});
