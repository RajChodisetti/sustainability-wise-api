import assert from 'node:assert/strict';
import test from 'node:test';
import { groupReadinessIssues } from '@/modules/installhub/lib/readinessPresentation';
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
