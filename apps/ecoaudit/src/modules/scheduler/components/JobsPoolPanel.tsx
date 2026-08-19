'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useUnscheduledJobs } from '@/modules/scheduler/hooks/useScheduler';
import { appChipClass, SOURCE_APP_LABEL } from '@/modules/scheduler/lib/colors';
import type { JobOption, ScheduleSourceApp } from '@/modules/scheduler/types/domain';

export type JobDragData = {
  type: 'job';
  job: JobOption;
};

const APP_FILTERS: Array<{ value: '' | Exclude<ScheduleSourceApp, 'custom'>; label: string }> = [
  { value: '', label: 'All apps' },
  { value: 'solarsense', label: 'Solar Sense' },
  { value: 'installhub', label: 'Field App' },
];

export function JobsPoolPanel({
  enabled,
  visibleSourceApps,
  className = '',
}: {
  enabled: boolean;
  visibleSourceApps: ScheduleSourceApp[];
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [app, setApp] = useState<'' | Exclude<ScheduleSourceApp, 'custom'>>('');
  const query = useUnscheduledJobs(
    { q, sourceApp: app || undefined },
    enabled,
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
                Unscheduled jobs
              </h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
              Drag a job onto an hour to schedule it.
            </p>
          </div>
          {!query.isLoading && !query.error ? (
            <span className="shrink-0 rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-extrabold text-[var(--text-sub)]">
              {(query.data ?? []).length}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] 2xl:grid-cols-1">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs"
            aria-label="Search unscheduled jobs"
          />
          <div>
            <FieldLabel className="sr-only">Product</FieldLabel>
            <Select
              value={app}
              onChange={(e) => setApp(e.target.value as typeof app)}
              aria-label="Filter jobs by product"
            >
              {APP_FILTERS.filter((filter) => (
                !filter.value || visibleSourceApps.includes(filter.value)
              )).map((f) => (
                <option key={f.value || 'all'} value={f.value}>
                  {f.label}
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
        {(query.data ?? []).map((job) => (
          <DraggableJobCard key={`${job.sourceApp}:${job.sourceType}:${job.id}`} job={job} />
        ))}
        {!query.isLoading && (query.data ?? []).length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--text-sub)]">
            No unscheduled jobs. Everything is on the calendar, or try another filter.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function DraggableJobCard({ job }: { job: JobOption }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `job:${job.sourceApp}:${job.sourceType}:${job.id}`,
    data: { type: 'job', job } satisfies JobDragData,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`cursor-grab rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] p-2.5 shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] active:cursor-grabbing ${
        isDragging ? 'opacity-50 ring-2 ring-[var(--primary)]' : ''
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-extrabold text-[var(--text)]">
          {job.label}
        </p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ${appChipClass(job.sourceApp)}`}
        >
          {SOURCE_APP_LABEL[job.sourceApp]}
        </span>
      </div>
      {job.subtitle ? (
        <p className="mt-1 line-clamp-2 text-[10px] font-semibold text-[var(--text-sub)]">
          {job.subtitle}
        </p>
      ) : null}
      <p className="mt-1 truncate font-mono text-[9px] text-[var(--muted)]">{job.id}</p>
    </div>
  );
}
