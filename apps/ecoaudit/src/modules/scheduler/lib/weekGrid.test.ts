import assert from 'node:assert/strict';
import test from 'node:test';
import { eventBlockStyle, eventLaneLayout } from './weekGrid';

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
