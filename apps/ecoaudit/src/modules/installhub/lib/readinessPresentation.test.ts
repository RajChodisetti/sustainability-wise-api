import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupReadinessIssues,
  partitionReadinessIssues,
} from '@/modules/installhub/lib/readinessPresentation';
import type { ReadinessIssue } from '@/modules/installhub/types/domain';

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
