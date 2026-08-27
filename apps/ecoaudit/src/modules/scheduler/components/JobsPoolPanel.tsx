'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useUnscheduledJobs } from '@/modules/scheduler/hooks/useScheduler';
import { groupJobsByAssignee, jobsForAssignee, sortJobsForPool } from '@/modules/scheduler/lib/jobsPool';
import type { JobOption } from '@/modules/scheduler/types/domain';

export type JobDragData = {
  type: 'job';
  job: JobOption;
};

export function JobsPoolPanel({
  enabled,
  onScheduledJobClick,
  className = '',
}: {
  enabled: boolean;
  onScheduledJobClick: (job: JobOption) => void;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const query = useUnscheduledJobs(
    { q, sourceApp: 'installhub', unscheduledOnly: false },
    enabled,
  );
  const jobs = useMemo(() => sortJobsForPool(query.data ?? []), [query.data]);
  const assigneeGroups = useMemo(() => groupJobsByAssignee(jobs), [jobs]);
  const visibleJobs = useMemo(
    () => jobsForAssignee(jobs, selectedAssignee),
    [jobs, selectedAssignee],
  );

  return (
    <aside
      id="scheduler-jobs-pool-panel"
      className={`flex min-h-80 w-full flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] ${className}`}
      aria-labelledby="scheduler-jobs-pool-title"
    >
      <div className="border-b border-[var(--border)] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="clipboard" size={18} className="text-[var(--primary)]" />
              <h3 id="scheduler-jobs-pool-title" className="text-sm font-extrabold text-[var(--text)]">
                Field jobs
              </h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
              All incomplete Field jobs, including unassigned and unscheduled work.
            </p>
          </div>
          {!query.isLoading && !query.error ? (
            <span className="shrink-0 rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-extrabold text-[var(--text-sub)]">
              {visibleJobs.length}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs"
            aria-label="Search Field jobs"
          />
          <div>
            <FieldLabel className="sr-only">Assigned user</FieldLabel>
            <Select
              value={selectedAssignee}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              aria-label="Filter jobs by assigned user"
            >
              <option value="">All users ({jobs.length} jobs)</option>
              {assigneeGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label} ({group.count} {group.count === 1 ? 'job' : 'jobs'})
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
      <div className="grid flex-1 content-start gap-2 overflow-y-auto p-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:block 2xl:space-y-2">
        {query.isLoading ? <Spinner label="Loading jobs…" /> : null}
        {query.error ? (
          <ErrorBanner message={(query.error as Error).message || 'Failed to load jobs'} />
        ) : null}
        {visibleJobs.map((job) => (
          <JobCard
            key={`${job.sourceApp}:${job.sourceType}:${job.id}`}
            job={job}
            onScheduledJobClick={onScheduledJobClick}
          />
        ))}
        {!query.isLoading && visibleJobs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--text-sub)]">
            No Field jobs match these filters.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function JobCard({
  job,
  onScheduledJobClick,
}: {
  job: JobOption;
  onScheduledJobClick: (job: JobOption) => void;
}) {
  const isScheduled = Boolean(job.scheduledEventId && job.scheduledStartAt);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `job:${job.sourceApp}:${job.sourceType}:${job.id}`,
    data: { type: 'job', job } satisfies JobDragData,
    disabled: isScheduled,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const scheduledInteractionProps = isScheduled ? {
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => onScheduledJobClick(job),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onScheduledJobClick(job);
      }
    },
  } : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      {...scheduledInteractionProps}
      className={`${isScheduled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] p-2.5 shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] ${
        isDragging ? 'opacity-50 ring-2 ring-[var(--primary)]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-extrabold text-[var(--text)]">
          {job.label}
        </p>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ${isScheduled ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
          {isScheduled ? 'Scheduled' : 'Unscheduled'}
        </span>
      </div>
      {job.subtitle ? (
        <p className="mt-1 line-clamp-2 text-[10px] font-semibold text-[var(--text-sub)]">
          {job.subtitle}
        </p>
      ) : null}
      <p className="mt-1 truncate text-[10px] font-semibold text-[var(--text-sub)]">
        {job.assigneeDisplayName?.trim() || 'Unassigned'}
      </p>
      {job.scheduledStartAt ? (
        <p className="mt-1 text-[10px] font-semibold text-[var(--primary)]">
          {new Date(job.scheduledStartAt).toLocaleString('en-AU', {
            weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
          })} · View week
        </p>
      ) : null}
      <p className="mt-1 truncate font-mono text-[9px] text-[var(--muted)]">{job.id}</p>
    </div>
  );
}
