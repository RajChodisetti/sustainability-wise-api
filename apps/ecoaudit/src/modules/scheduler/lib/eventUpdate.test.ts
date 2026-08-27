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
  assert.match(modalSource, /Scope categorization/);
  assert.match(modalSource, /M1 - New install/);
  assert.match(modalSource, /M2 - Faults \/ COMMS fault/);
  assert.match(modalSource, /M3 - Inspection/);
  assert.match(modalSource, /M4 - BD\/Upselling/);
  assert.match(modalSource, /M5 — Other/);
  assert.match(modalSource, /Metering type selection/);
  assert.match(modalSource, /scheduler-custom-job-number/);
  assert.doesNotMatch(modalSource, /scheduler-planned-meter-type/);
  assert.match(modalSource, /scheduler-job-comments/);
  assert.doesNotMatch(modalSource, /scheduler-(?:fergus-job|quote-number|customer-name)/);
  assert.doesNotMatch(
    modalSource,
    /scheduler-(?:warranty-device|monitoring-installed|hardware-installed|solar-capacity|additional-monitoring|additional-hardware)/,
  );
});

test('removed scheduler helper copy stays absent', () => {
  const modalSource = readFileSync(new URL('../components/EventFormModal.tsx', import.meta.url), 'utf8');
  const addressSource = readFileSync(new URL('../components/AustralianAddressFields.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(modalSource, /A Draft product record will be created/);
  assert.doesNotMatch(modalSource, /Saved on the canonical incoming grid supply/);
  assert.doesNotMatch(modalSource, /Installed device records remain authoritative/);
  assert.doesNotMatch(addressSource, /Choose a suggestion to make routing precise/);
  assert.doesNotMatch(addressSource, /Address suggestions are not configured right now/);
});

test('new product jobs require an explicit new-site or existing-site choice', () => {
  const modalSource = readFileSync(
    new URL('../components/EventFormModal.tsx', import.meta.url),
    'utf8',
  );

  assert.match(modalSource, /Is this work for a new or existing site\?/);
  assert.match(modalSource, /Find existing site/);
  assert.match(modalSource, /siteMode: siteSelectionMode/);
  assert.match(modalSource, /existingSiteId: siteSelectionMode === 'existing'/);
  assert.match(modalSource, /new independent job version/);
});
