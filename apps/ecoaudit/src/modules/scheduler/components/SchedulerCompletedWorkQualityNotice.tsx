import type { SchedulerAnalyticsDto } from '@/modules/scheduler/types/analytics';

type CompletedWorkQuality = SchedulerAnalyticsDto['quality']['completedWorkRevenue'];

export function SchedulerCompletedWorkQualityNotice({
  quality,
}: {
  quality: CompletedWorkQuality;
}) {
  const unavailableJobs = quality.snapshotUnavailableJobs
    + quality.historicalRevenueUnavailableJobs;
  if (
    quality.snapshotIncompleteJobs === 0
    && unavailableJobs === 0
    && quality.undatedCompletedJobs === 0
  ) return null;

  return (
    <div
      className="rounded-[var(--radius-sm)] border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-4 py-3 text-sm leading-6 text-[var(--text)]"
      role="status"
    >
      <strong>Completed-work revenue review:</strong>{' '}
      {quality.snapshotIncompleteJobs > 0 ? (
        <>{quality.snapshotIncompleteJobs} completed job{quality.snapshotIncompleteJobs === 1 ? '' : 's'} use{quality.snapshotIncompleteJobs === 1 ? 's' : ''} a captured value that still needs finance review. </>
      ) : null}
      {unavailableJobs > 0 ? (
        <>{quality.snapshotUnavailableJobs} completion fact{quality.snapshotUnavailableJobs === 1 ? '' : 's'} and {quality.historicalRevenueUnavailableJobs} historical job{quality.historicalRevenueUnavailableJobs === 1 ? '' : 's'} remain in completed-job counts but are omitted from completed-work revenue because no trustworthy historical snapshot is available. </>
      ) : null}
      {quality.undatedCompletedJobs > 0 ? (
        <>{quality.undatedCompletedJobs} retained completed job{quality.undatedCompletedJobs === 1 ? '' : 's'} cannot be placed in this or any other date window because no completion timestamp is stored; no date is invented. </>
      ) : null}
      Historical snapshots are not recalculated automatically; a revenue restatement will require an explicit audited workflow.
    </div>
  );
}
