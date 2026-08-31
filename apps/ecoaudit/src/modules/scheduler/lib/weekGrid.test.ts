import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarDayMinWidthRem,
  calendarEventContentDensity,
  calendarEventLaneDensity,
  calendarEventVisualState,
  calendarPreviewPosition,
  eventBlockStyle,
  eventLaneLayout,
} from './weekGrid';

test('calendar retains completed jobs and warns only after an incomplete scheduled day passes', () => {
  const now = new Date(2026, 7, 29, 12, 0, 0);

  assert.equal(calendarEventVisualState('done', '2026-08-30T09:00:00', now), 'completed');
  assert.equal(calendarEventVisualState('planned', '2026-08-28T09:00:00', now), 'overdue');
  assert.equal(calendarEventVisualState('in_progress', '2026-08-28T09:00:00', now), 'overdue');
  assert.equal(calendarEventVisualState('planned', '2026-08-29T08:00:00', now), 'default');
  assert.equal(calendarEventVisualState('planned', '2026-08-30T08:00:00', now), 'default');
  assert.equal(calendarEventVisualState('cancelled', '2026-08-28T09:00:00', now), 'default');
});

test('calendar card content adapts to the rendered event height', () => {
  assert.equal(calendarEventContentDensity(28), 'title');
  assert.equal(calendarEventContentDensity(56), 'meta');
  assert.equal(calendarEventContentDensity(84), 'full');
});

test('calendar card chrome adapts to overlapping lane width', () => {
  assert.equal(calendarEventLaneDensity(33.33), 'tight');
  assert.equal(calendarEventLaneDensity(50), 'compact');
  assert.equal(calendarEventLaneDensity(100), 'full');
});

test('expanded calendar previews stay beside their triggers and clamp to viewport edges', () => {
  assert.deepEqual(calendarPreviewPosition({
    triggerLeft: 4,
    triggerRight: 44,
    triggerTop: 8,
    triggerBottom: 36,
    previewWidth: 304,
    previewHeight: 210,
    viewportWidth: 390,
    viewportHeight: 844,
    preferredAlign: 'left',
  }), { left: 52, top: 12, maxHeight: 820, placement: 'right' });

  assert.deepEqual(calendarPreviewPosition({
    triggerLeft: 360,
    triggerRight: 388,
    triggerTop: 780,
    triggerBottom: 808,
    previewWidth: 304,
    previewHeight: 210,
    viewportWidth: 390,
    viewportHeight: 844,
    preferredAlign: 'right',
  }), { left: 48, top: 622, maxHeight: 820, placement: 'left' });

  assert.deepEqual(calendarPreviewPosition({
    triggerLeft: 180,
    triggerRight: 210,
    triggerTop: 300,
    triggerBottom: 328,
    previewWidth: 304,
    previewHeight: 210,
    viewportWidth: 390,
    viewportHeight: 844,
    preferredAlign: 'left',
  }), { left: 74, top: 336, maxHeight: 496, placement: 'bottom' });
});

function event(
  id: string,
  start: string,
  end: string | null,
  estimatedDurationMinutes: number | null = null,
) {
  return {
    id,
    scheduledStartAt: start,
    estimatedDurationMinutes,
    scheduledEndAt: end,
  };
}

test('calendar height uses the estimate and does not assume a duration when absent', () => {
  assert.equal(eventBlockStyle('2026-08-17T09:00:00', 120, null).height, 112);
  assert.equal(eventBlockStyle('2026-08-17T09:00:00', null, null).height, 28);
});

test('calendar retains historical end-time reads when no estimate is stored', () => {
  assert.equal(
    eventBlockStyle(
      '2026-08-17T09:00:00',
      null,
      '2026-08-17T10:30:00',
    ).height,
    84,
  );
});

test('stored estimate takes precedence over a historical end time', () => {
  const layout = eventLaneLayout([
    event('estimated', '2026-08-17T09:00:00.000Z', '2026-08-17T12:00:00.000Z', 30),
    event('later', '2026-08-17T10:00:00.000Z', null),
  ]);

  assert.deepEqual(layout.get('estimated'), { leftPercent: 0, widthPercent: 100 });
  assert.deepEqual(layout.get('later'), { leftPercent: 0, widthPercent: 100 });
});

test('non-overlapping scheduler events retain the full day-column width', () => {
  const layout = eventLaneLayout([
    event('morning', '2026-08-17T09:00:00.000Z', '2026-08-17T10:00:00.000Z'),
    event('afternoon', '2026-08-17T13:00:00.000Z', '2026-08-17T14:00:00.000Z'),
  ]);

  assert.deepEqual(layout.get('morning'), { leftPercent: 0, widthPercent: 100 });
  assert.deepEqual(layout.get('afternoon'), { leftPercent: 0, widthPercent: 100 });
});

test('simultaneous scheduler events render in separate equal-width lanes', () => {
  const layout = eventLaneLayout([
    event('a', '2026-08-17T09:00:00.000Z', '2026-08-17T10:00:00.000Z'),
    event('b', '2026-08-17T09:00:00.000Z', '2026-08-17T10:30:00.000Z'),
    event('c', '2026-08-17T09:15:00.000Z', '2026-08-17T10:15:00.000Z'),
  ]);

  assert.deepEqual(layout.get('a'), { leftPercent: 0, widthPercent: 100 / 3 });
  assert.equal(layout.get('b')?.leftPercent, (1 / 3) * 100);
  assert.equal(layout.get('b')?.widthPercent, 100 / 3);
  assert.equal(layout.get('c')?.leftPercent, (2 / 3) * 100);
  assert.equal(layout.get('c')?.widthPercent, 100 / 3);
});

test('busy days widen before four or more simultaneous jobs become slivers', () => {
  const overlapping = Array.from({ length: 5 }, (_, index) => event(
    `busy-${index}`,
    '2026-08-17T09:00:00.000Z',
    '2026-08-17T10:00:00.000Z',
  ));

  assert.equal(calendarDayMinWidthRem(overlapping.slice(0, 2)), 8);
  assert.equal(calendarDayMinWidthRem(overlapping.slice(0, 4)), 12);
  assert.equal(calendarDayMinWidthRem(overlapping), 15);
});

test('transitive overlaps share lanes and reuse a lane after it becomes free', () => {
  const layout = eventLaneLayout([
    event('a', '2026-08-17T09:00:00.000Z', '2026-08-17T11:00:00.000Z'),
    event('b', '2026-08-17T10:00:00.000Z', '2026-08-17T12:00:00.000Z'),
    event('c', '2026-08-17T11:30:00.000Z', '2026-08-17T12:30:00.000Z'),
  ]);

  assert.deepEqual(layout.get('a'), { leftPercent: 0, widthPercent: 50 });
  assert.deepEqual(layout.get('b'), { leftPercent: 50, widthPercent: 50 });
  assert.deepEqual(layout.get('c'), { leftPercent: 0, widthPercent: 50 });
});
