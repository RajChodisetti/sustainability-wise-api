import assert from 'node:assert/strict';
import test from 'node:test';
import type { JobOption } from '@/modules/scheduler/types/domain';
import {
  groupJobsByAssignee,
  jobsForAssignee,
  scheduledJobWeek,
  sortJobsForPool,
  UNASSIGNED_JOB_GROUP,
} from './jobsPool';

const jobs: JobOption[] = [
  {
    id: 'job-1', label: 'One', sourceApp: 'installhub', sourceType: 'installation',
    assigneeFieldUserId: 'sriraj', assigneeDisplayName: 'Sriraj',
  },
  {
    id: 'job-2', label: 'Two', sourceApp: 'installhub', sourceType: 'installation',
    assigneeFieldUserId: 'sriraj', assigneeDisplayName: 'Sriraj',
  },
  {
    id: 'job-3', label: 'Three', sourceApp: 'installhub', sourceType: 'installation',
    assigneeFieldUserId: 'sri', assigneeDisplayName: 'Sri',
    scheduledStartAt: '2026-08-20T23:30:00.000Z', scheduledEventId: 'event-3',
  },
  { id: 'job-4', label: 'Four', sourceApp: 'installhub', sourceType: 'installation' },
];

test('Field jobs group by assigned user with stable counts and an unassigned bucket', () => {
  assert.deepEqual(groupJobsByAssignee(jobs), [
    { id: 'sri', label: 'Sri', count: 1 },
    { id: 'sriraj', label: 'Sriraj', count: 2 },
    { id: UNASSIGNED_JOB_GROUP, label: 'Unassigned', count: 1 },
  ]);
  assert.deepEqual(jobsForAssignee(jobs, 'sriraj').map((job) => job.id), ['job-1', 'job-2']);
  assert.deepEqual(jobsForAssignee(jobs, '').map((job) => job.id), jobs.map((job) => job.id));
});

test('Field jobs sort by assignment and scheduling state', () => {
  const scheduledLater = { ...jobs[2], id: 'job-5', scheduledStartAt: '2026-08-22T09:00:00.000Z' };
  assert.deepEqual(
    sortJobsForPool([scheduledLater, jobs[0], jobs[2], jobs[3]]).map((job) => job.id),
    ['job-4', 'job-1', 'job-3', 'job-5'],
  );
});

test('scheduled Field jobs resolve to the Monday of their calendar week', () => {
  const week = scheduledJobWeek(jobs[2]);
  assert.equal(week?.getDay(), 1);
  assert.equal(week?.getFullYear(), 2026);
  assert.equal(week?.getMonth(), 7);
  assert.equal(week?.getDate(), 17);
  assert.equal(scheduledJobWeek(jobs[0]), null);
  assert.equal(scheduledJobWeek({ ...jobs[0], scheduledStartAt: 'not-a-date' }), null);
});
