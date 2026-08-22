import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scheduledStartUpdate } from './eventUpdate';

test('unchanged rendered start is omitted from an event edit', () => {
  assert.deepEqual(
    scheduledStartUpdate(
      '2026-08-19T09:00',
      '2026-08-19T09:00',
      '2026-08-19T16:00:00.000Z',
    ),
    {},
  );
});

test('a changed rendered start is included as the converted instant', () => {
  assert.deepEqual(
    scheduledStartUpdate(
      '2026-08-19T09:00',
      '2026-08-19T10:30',
      '2026-08-19T17:30:00.000Z',
    ),
    { scheduledStartAt: '2026-08-19T17:30:00.000Z' },
  );
});

test('event modal edit uses changed-field-aware start payloads', () => {
  const modalSource = readFileSync(
    new URL('../components/EventFormModal.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    modalSource,
    /\.\.\.scheduledStartUpdate\(\s*initial\.startLocal,\s*startLocal,/,
  );
});

test('new Field App jobs collect planning inputs without installation outcomes', () => {
  const modalSource = readFileSync(
    new URL('../components/EventFormModal.tsx', import.meta.url),
    'utf8',
  );

  assert.match(modalSource, /Field App job planning and scope/);
  assert.match(modalSource, /scheduler-job-comments/);
  assert.doesNotMatch(
    modalSource,
    /scheduler-(?:warranty-device|monitoring-installed|hardware-installed|solar-capacity|additional-monitoring|additional-hardware)/,
  );
});
