import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  scheduledStartUpdate,
  shouldCompleteLinkedProductJob,
} from './eventUpdate';

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

test('selecting done completes only a linked, currently incomplete product job', () => {
  assert.equal(shouldCompleteLinkedProductJob({
    currentStatus: 'planned',
    nextStatus: 'done',
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: 'field-job-1',
  }), true);
  for (const input of [
    { currentStatus: 'done', nextStatus: 'done', sourceApp: 'installhub', sourceType: 'installation', sourceId: 'field-job-1' },
    { currentStatus: 'planned', nextStatus: 'planned', sourceApp: 'installhub', sourceType: 'installation', sourceId: 'field-job-1' },
    { currentStatus: 'planned', nextStatus: 'done', sourceApp: 'custom', sourceType: 'custom', sourceId: null },
    { currentStatus: 'planned', nextStatus: 'done', sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: null },
  ]) {
    assert.equal(shouldCompleteLinkedProductJob(input), false);
  }
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

test('opened product jobs expose Scheduler fallback completion controls', () => {
  const modalSource = readFileSync(
    new URL('../components/EventFormModal.tsx', import.meta.url),
    'utf8',
  );
  const financeSource = readFileSync(
    new URL('../components/SchedulerFinanceDetail.tsx', import.meta.url),
    'utf8',
  );

  assert.match(modalSource, /Mark job complete/);
  assert.match(modalSource, /completes the linked product job and closes its Scheduler work/);
  assert.match(modalSource, /useCompleteSchedulerJob/);
  assert.match(modalSource, /shouldCompleteLinkedProductJob/);
  assert.match(modalSource, /status: completeLinkedJob \? event\.status : status/);
  assert.match(financeSource, /Mark job complete/);
  assert.match(financeSource, /useCompleteSchedulerJob/);
});

test('calendar drag assignment expands a day into technician lanes and confirms the drop', () => {
  const boardSource = readFileSync(
    new URL('../components/DynamicSchedulerBoard.tsx', import.meta.url),
    'utf8',
  );
  const gridSource = readFileSync(
    new URL('../components/WeekTimeGrid.tsx', import.meta.url),
    'utf8',
  );

  assert.match(boardSource, /onDragOver=\{onDragOver\}/);
  assert.match(boardSource, /setExpandedDayKey\(overData\.dayKey\)/);
  assert.match(boardSource, /overData\.assigneeFieldUserId/);
  assert.match(boardSource, /Confirm job assignment/);
  assert.match(boardSource, /AssignmentSummaryRow label="Technician"/);
  assert.match(boardSource, /AssignmentSummaryRow label="Job"/);
  assert.match(boardSource, /AssignmentSummaryRow label="Date & time"/);
  assert.match(gridSource, /expandedDayKey/);
  assert.match(gridSource, /assigneeFieldUserId=\{user\.fieldUserId\}/);
  assert.match(gridSource, /Technicians available on/);
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
  assert.doesNotMatch(modalSource, /scheduler-custom-job-number|customJobNumber/);
  assert.match(modalSource, /titleSuffix: fieldJobTitleSuffix/);
  assert.match(modalSource, /schedulerFieldJobTitlePreview\(/);
  assert.doesNotMatch(modalSource, / - XXX/);
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
  assert.match(modalSource, /schedulerDispatchSiteSelectionPayload\(\{/);
  assert.match(modalSource, /address: jobAddress/);
  assert.match(modalSource, /existingSiteId,/);
  assert.match(modalSource, /clientId: selectedClientId/);
  assert.match(modalSource, /schedulerSiteOptionLabel\(site\)/);
  assert.match(modalSource, /previous job data is not copied/);
  assert.ok(
    (modalSource.match(/clearSchedulerFieldJobPlanning\(current\)/g) ?? []).length >= 3,
    'every existing-site entry path clears Field planning values',
  );
  assert.doesNotMatch(modalSource, /latestRevisionNumber/);
  assert.doesNotMatch(modalSource, /latest(?:WorkType|MeteringSolutionType|CustomJobNumber|JobComments|Maas|ElectricityNmi)/);
  assert.doesNotMatch(modalSource, /new independent job version/);
});
