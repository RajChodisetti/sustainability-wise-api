import { startOfWeekMonday } from '@/modules/scheduler/lib/weekGrid';
import type { JobOption } from '@/modules/scheduler/types/domain';

export const UNASSIGNED_JOB_GROUP = '__unassigned';

export type JobAssigneeGroup = {
  id: string;
  label: string;
  count: number;
};

export function jobAssigneeGroupId(job: JobOption): string {
  return job.assigneeFieldUserId || UNASSIGNED_JOB_GROUP;
}

export function groupJobsByAssignee(jobs: readonly JobOption[]): JobAssigneeGroup[] {
  const groups = new Map<string, JobAssigneeGroup>();
  for (const job of jobs) {
    const id = jobAssigneeGroupId(job);
    const current = groups.get(id);
    if (current) current.count += 1;
    else groups.set(id, {
      id,
      label: job.assigneeDisplayName?.trim() || 'Unassigned',
      count: 1,
    });
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function jobsForAssignee(
  jobs: readonly JobOption[],
  assigneeGroupId: string,
): JobOption[] {
  if (!assigneeGroupId) return [...jobs];
  return jobs.filter((job) => jobAssigneeGroupId(job) === assigneeGroupId);
}

function jobPoolRank(job: JobOption): number {
  if (job.scheduledStartAt) return 2;
  if (job.assigneeFieldUserId) return 1;
  return 0;
}

/** Unassigned/unscheduled, then assigned/unscheduled, then scheduled chronologically. */
export function sortJobsForPool(jobs: readonly JobOption[]): JobOption[] {
  return [...jobs].sort((left, right) => {
    const rankDifference = jobPoolRank(left) - jobPoolRank(right);
    if (rankDifference !== 0) return rankDifference;
    if (left.scheduledStartAt && right.scheduledStartAt) {
      const timeDifference = new Date(left.scheduledStartAt).getTime()
        - new Date(right.scheduledStartAt).getTime();
      if (timeDifference !== 0) return timeDifference;
    }
    return left.label.localeCompare(right.label);
  });
}

export function scheduledJobWeek(job: JobOption): Date | null {
  if (!job.scheduledStartAt) return null;
  const scheduledStart = new Date(job.scheduledStartAt);
  if (Number.isNaN(scheduledStart.getTime())) return null;
  return startOfWeekMonday(scheduledStart);
}
