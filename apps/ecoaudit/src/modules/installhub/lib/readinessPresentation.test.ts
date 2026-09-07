import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  groupReadinessIssues,
  partitionReadinessIssues,
  reconciliationIssueWhy,
} from '@/modules/installhub/lib/readinessPresentation';
import type { ReadinessIssue } from '@/modules/installhub/types/domain';

const canonicalDataSource = readFileSync(
  new URL('../pages/CanonicalDataPage.tsx', import.meta.url),
  'utf8',
);

test('readiness presentation groups duplicate technical checks under human labels', () => {
  const issue = (entityId: string): ReadinessIssue => ({
    code: 'CHANNEL_UNASSIGNED',
    severity: 'ERROR',
    entityType: 'channel',
    entityId,
    message: 'Every non-spare meter channel must belong to exactly one measurement assignment.',
  });
  const groups = groupReadinessIssues([issue('channel-1'), issue('channel-2')]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Unassigned device channels');
  assert.equal(groups[0].count, 2);
  assert.deepEqual(groups[0].issues.map((item) => item.entityId), ['channel-1', 'channel-2']);
  assert.equal(groups[0].details.length, 1);
  assert.equal(groups[0].details[0].count, 2);
  assert.doesNotMatch(groups[0].title, /CHANNEL_|_/);
});

test('readiness presentation separates deliberate TBC work from completion defects', () => {
  const issues: ReadinessIssue[] = [
    {
      code: 'SUPPLY_TBC',
      severity: 'ERROR',
      entityType: 'board',
      entityId: 'board-1',
      message: 'Confirm supply.',
    },
    {
      code: 'METERING_STATE_INVALID',
      severity: 'ERROR',
      entityType: 'site_asset',
      entityId: 'asset-1',
      field: 'meteringState',
      message: 'Confirm metering state.',
    },
    {
      code: 'METERING_STATE_INVALID',
      severity: 'ERROR',
      entityType: 'site_asset',
      entityId: 'asset-2',
      field: 'meteringState.measurementAssignmentIds',
      message: 'Fix duplicate assignments.',
    },
    {
      code: 'FORM_INCOMPLETE',
      severity: 'ERROR',
      entityType: 'form',
      entityId: 'form-1',
      message: 'Complete or delete this draft.',
    },
  ];

  const split = partitionReadinessIssues(issues);

  assert.deepEqual(split.reconciliation.map((issue) => issue.entityId), [
    'board-1',
    'asset-1',
  ]);
  assert.deepEqual(split.completion.map((issue) => issue.entityId), [
    'asset-2',
    'form-1',
  ]);
});

test('readiness presentation explains reconciliation errors in plain language', () => {
  const issue = (
    code: string,
    entityType: ReadinessIssue['entityType'],
    field?: string,
  ): ReadinessIssue => ({
    code,
    severity: 'ERROR',
    entityType,
    entityId: 'record-1',
    field,
    message: 'Technical validation message.',
  });

  assert.equal(
    reconciliationIssueWhy(issue('SUPPLY_TBC', 'board')),
    'This switchboard was saved without a confirmed incoming connection or parent switchboard.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('SUPPLY_TBC', 'site_asset')),
    'This asset was saved without a confirmed incoming connection or supplying switchboard.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('METERING_STATE_INVALID', 'site_asset', 'meteringState')),
    'This asset was saved without confirming whether it is metered or unmetered.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('METERING_STATE_INVALID', 'site_asset', 'meteringState.measurementAssignmentIds')),
    'The asset metering choice does not match its saved measurement group.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('MEASUREMENT_TARGET_TBC', 'measurement_assignment', 'target')),
    'This channel group was saved without confirming what it measures.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('CHANNEL_DUPLICATE_ASSIGNMENT', 'measurement_assignment', 'channelIds')),
    'The same device channel is included in more than one measurement group, so its reading would be counted twice.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('SENSOR_RATING_INVALID', 'meter', 'channels')),
    'The saved CT or Rogowski rating is missing or does not match this device type.',
  );
});

test('data and reconciliation shows the plain-language reason without a Metering table entry point', () => {
  assert.match(canonicalDataSource, /Why:<\/span> \{reconciliationIssueWhy\(issue\)\}/);
  assert.doesNotMatch(
    canonicalDataSource,
    /href=\{`\/installhub\/installations\/\$\{installationId\}\/metering`\}/,
  );
});
