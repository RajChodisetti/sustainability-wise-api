'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { useUnscheduledJobs } from '@/modules/scheduler/hooks/useScheduler';
import { appChipClass, SOURCE_APP_LABEL } from '@/modules/scheduler/lib/colors';
import type { JobOption, ScheduleSourceApp } from '@/modules/scheduler/types/domain';

export type JobDragData = {
  type: 'job';
  job: JobOption;
};

const APP_FILTERS: Array<{ value: '' | Exclude<ScheduleSourceApp, 'custom'>; label: string }> = [
  { value: '', label: 'All apps' },
  { value: 'ecoaudit', label: 'Eco Audit' },
  { value: 'solarsense', label: 'Solar Sense' },
  { value: 'installhub', label: 'Field App' },
];

export function JobsPoolPanel({
  enabled,
  visibleSourceApps,
}: {
  enabled: boolean;
  visibleSourceApps: ScheduleSourceApp[];
}) {
  const [q, setQ] = useState('');
  const [app, setApp] = useState<'' | Exclude<ScheduleSourceApp, 'custom'>>('');
  const query = useUnscheduledJobs(
    { q, sourceApp: app || undefined },
    enabled,
  );

  return (
    <aside className="flex h-full min-h-[28rem] w-full flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] lg:w-64 xl:w-72">
      <div className="space-y-2 border-b border-[var(--border)] px-3 py-3">
        <h3 className="text-sm font-extrabold text-[var(--text)]">Jobs</h3>
        <p className="text-[11px] font-semibold text-[var(--text-sub)]">
          Drag onto the calendar to assign day & time.
        </p>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs"
          aria-label="Search unscheduled jobs"
        />
        <div>
          <FieldLabel className="!mt-0">Filter</FieldLabel>
          <Select
            value={app}
            onChange={(e) => setApp(e.target.value as typeof app)}
            aria-label="Filter by app"
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
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
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
      className={`cursor-grab rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-2.5 active:cursor-grabbing ${
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
