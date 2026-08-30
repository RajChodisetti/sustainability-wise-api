'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorBanner, Spinner } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { SchedulerBillsWorkspace } from '@/modules/scheduler/components/SchedulerBillsWorkspace';
import { SchedulerFinanceDetail } from '@/modules/scheduler/components/SchedulerFinanceDetail';
import { SchedulerInvoicesWorkspace } from '@/modules/scheduler/components/SchedulerInvoicesWorkspace';
import { SchedulerPortfolioSummary } from '@/modules/scheduler/components/SchedulerPortfolioSummary';
import {
  useSchedulerFinanceOverview,
  useSchedulerFinanceSourceTarget,
  useSchedulerFinancialSummary,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  compareFinanceExceptionJobs,
  financeExceptionCounts,
  financeAppLabel,
  financeJobKey,
  financeJobExceptionKinds,
  financeJobMatchesExceptionFilter,
  financeOverviewFromSummary,
  financeTargetFromPages,
  financeTargetLookupFailed,
  financeTargetRequiresJobLookup,
  marginTone,
  schedulerFinanceHref,
  selectedVisibleFinanceJob,
  type FinanceExceptionFilter,
  type FinanceExceptionKind,
} from '@/modules/scheduler/lib/finance';
import { schedulerVisibleFinanceSourceApps } from '@/modules/scheduler/lib/visibility';
import type {
  FinanceOverviewItem,
  FinanceSourceApp,
  ScheduleSourceApp,
  SchedulerFinanceTarget,
  SchedulerFinanceView,
} from '@/modules/scheduler/types/domain';

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

function dateLabel(value: string | null): string {
  if (!value) return 'Date not set';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const toneClasses = {
  success: 'text-[var(--green)]',
  warning: 'text-[var(--amber)]',
  danger: 'text-[var(--red)]',
  neutral: 'text-[var(--text-sub)]',
};

export function SchedulerFinanceWorkspace({
  view,
  initialTarget,
  visibleSourceApps,
  selectableSourceApps,
  onActivateView,
}: {
  view: SchedulerFinanceView;
  initialTarget?: SchedulerFinanceTarget;
  visibleSourceApps: ScheduleSourceApp[];
  selectableSourceApps: ScheduleSourceApp[];
  onActivateView: (view: SchedulerFinanceView) => void;
}) {
  const overview = useSchedulerFinanceOverview(true);
  const requestedJobTarget = financeTargetRequiresJobLookup(initialTarget) ? initialTarget : undefined;
  const directTarget = useSchedulerFinancialSummary(requestedJobTarget?.financeId ?? null);
  const exactSourceTarget = useSchedulerFinanceSourceTarget(
    requestedJobTarget?.financeId ? undefined : requestedJobTarget?.sourceApp,
    requestedJobTarget?.financeId ? undefined : requestedJobTarget?.sourceId,
  );
  const [search, setSearch] = useState('');
  const [sourceApp, setSourceApp] = useState<FinanceSourceApp | 'all'>('all');
  const [exceptionFilter, setExceptionFilter] = useState<FinanceExceptionFilter>('all');
  const [selectedJobKey, setSelectedJobKey] = useState<string | null>(null);
  const appliedTargetRef = useRef<string | null>(null);
  const visibleFinanceSourceApps = useMemo(
    () => schedulerVisibleFinanceSourceApps(visibleSourceApps),
    [visibleSourceApps],
  );
  const selectableFinanceSourceApps = useMemo(
    () => schedulerVisibleFinanceSourceApps(selectableSourceApps),
    [selectableSourceApps],
  );

  const items = useMemo(() => {
    const byFinanceId = new Map<string, FinanceOverviewItem>();
    for (const page of overview.data?.pages ?? []) {
      for (const job of page.items) byFinanceId.set(job.financeId, job);
    }
    for (const job of exactSourceTarget.data?.items ?? []) byFinanceId.set(job.financeId, job);
    if (directTarget.data) {
      const job = financeOverviewFromSummary(directTarget.data);
      byFinanceId.set(job.financeId, job);
    }
    return [...byFinanceId.values()]
      .filter((job) => visibleFinanceSourceApps.includes(job.sourceApp))
      .sort(compareFinanceExceptionJobs);
  }, [directTarget.data, exactSourceTarget.data, overview.data, visibleFinanceSourceApps]);
  const initialTargetJob = financeTargetFromPages([{ items, nextCursor: null }], requestedJobTarget);
  const initialTargetFailed = financeTargetLookupFailed({
    target: requestedJobTarget,
    resolved: Boolean(initialTargetJob),
    directLookupTerminal: directTarget.isError || directTarget.isSuccess,
    exactSourceLookupTerminal: exactSourceTarget.isError || exactSourceTarget.isSuccess,
    cursorLookupTerminal: overview.isError
      || overview.isFetchNextPageError
      || (overview.isSuccess && !overview.hasNextPage),
  });
  const requestedTargetResolving = Boolean(
    requestedJobTarget
    && !initialTargetJob
    && !initialTargetFailed,
  );
  const needsCursorScan = Boolean(
    requestedJobTarget?.eventId
    && !requestedJobTarget.financeId
    && !(requestedJobTarget.sourceApp && requestedJobTarget.sourceId),
  );
  const initialTargetError = requestedJobTarget?.financeId
    ? directTarget.error
    : requestedJobTarget?.sourceApp && requestedJobTarget.sourceId
      ? exactSourceTarget.error
      : overview.error;

  useEffect(() => {
    const targetSignature = initialTarget ? JSON.stringify(initialTarget) : '';
    const unappliedTarget = initialTarget && appliedTargetRef.current !== targetSignature;
    const targetJob = unappliedTarget ? initialTargetJob : undefined;
    if (targetJob && initialTarget) {
      appliedTargetRef.current = targetSignature;
      setSelectedJobKey(financeJobKey(targetJob));
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', schedulerFinanceHref({
          view,
          financeId: targetJob.financeId,
          eventId: targetJob.eventId ?? undefined,
          sourceApp: targetJob.sourceApp,
          sourceId: targetJob.sourceId,
          invoiceId: initialTarget.invoiceId,
        }));
      }
      return;
    }
    if (unappliedTarget && initialTargetFailed) return;
    if (unappliedTarget && requestedTargetResolving) {
      if (needsCursorScan && overview.hasNextPage && !overview.isFetchingNextPage && !overview.isFetchNextPageError) {
        void overview.fetchNextPage();
      }
      return;
    }
    if (unappliedTarget) {
      appliedTargetRef.current = targetSignature;
      if (typeof window !== 'undefined' && initialTarget) {
        window.history.replaceState(null, '', schedulerFinanceHref({
          view,
          financeId: initialTarget.financeId,
          eventId: initialTarget.eventId,
          sourceApp: initialTarget.sourceApp,
          sourceId: initialTarget.sourceId,
          invoiceId: initialTarget.invoiceId,
        }));
      }
    }
    if (items.length > 0 && (!selectedJobKey || !items.some((job) => financeJobKey(job) === selectedJobKey))) {
      setSelectedJobKey(financeJobKey(items[0]));
    }
  }, [initialTarget, initialTargetFailed, initialTargetJob, items, needsCursorScan, overview, requestedTargetResolving, selectedJobKey, view]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((job) => {
      if (sourceApp !== 'all' && job.sourceApp !== sourceApp) return false;
      if (!financeJobMatchesExceptionFilter(job, exceptionFilter)) return false;
      if (!needle) return true;
      return `${job.jobName} ${job.clientName ?? ''} ${job.siteName} ${job.siteAddress ?? ''} ${job.userNames.join(' ')} ${job.sourceId} ${financeAppLabel(job.sourceApp)}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [exceptionFilter, items, search, sourceApp]);
  const selected = selectedVisibleFinanceJob(filtered, selectedJobKey);

  function loadMoreJobs() {
    if (overview.hasNextPage && !overview.isFetchingNextPage) void overview.fetchNextPage();
  }

  if (requestedTargetResolving) {
    return <Spinner label="Loading requested finance job…" />;
  }
  if (initialTargetFailed) {
    const retry = requestedJobTarget?.financeId
      ? directTarget.refetch
      : requestedJobTarget?.sourceApp && requestedJobTarget.sourceId
        ? exactSourceTarget.refetch
        : overview.isFetchNextPageError
          ? overview.fetchNextPage
          : overview.refetch;
    return (
      <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)]">
        <ErrorBanner message={`Could not open the requested finance job. ${initialTargetError ? cloudConnectionErrorMessage(initialTargetError) : 'It may no longer exist or you may no longer have access.'}`} />
        <Button type="button" variant="secondary" onClick={() => void retry()}>Try again</Button>
      </div>
    );
  }

  if (view === 'bills') {
    return (
      <SchedulerBillsWorkspace
        jobs={items}
        visibleSourceApps={visibleFinanceSourceApps}
        filterSourceApps={selectableFinanceSourceApps}
        initialFinanceId={initialTargetJob?.financeId}
        hasMoreJobs={Boolean(overview.hasNextPage)}
        loadingMoreJobs={overview.isFetchingNextPage}
        onLoadMoreJobs={loadMoreJobs}
      />
    );
  }

  if (view === 'invoices') {
    return (
      <SchedulerInvoicesWorkspace
        jobs={items}
        visibleSourceApps={visibleFinanceSourceApps}
        filterSourceApps={selectableFinanceSourceApps}
        initialFinanceId={initialTargetJob?.financeId}
        initialInvoiceId={initialTarget?.invoiceId}
        hasMoreJobs={Boolean(overview.hasNextPage)}
        loadingMoreJobs={overview.isFetchingNextPage}
        onLoadMoreJobs={loadMoreJobs}
      />
    );
  }

  if (overview.isLoading) {
    return <Spinner label="Loading financial summary…" />;
  }
  if (overview.isError && items.length === 0) return <ErrorBanner message={cloudConnectionErrorMessage(overview.error)} />;

  return (
    <div className="space-y-5">
      <SchedulerPortfolioSummary
        visibleSourceApps={visibleFinanceSourceApps}
        onActivateInvoices={() => onActivateView('invoices')}
      />
      {items.length === 0 ? (
        <EmptyState
          title="No jobs are ready for finance"
          description={visibleFinanceSourceApps.length === 1 && visibleFinanceSourceApps[0] === 'installhub'
            ? 'Create a Field App installation in Scheduler to start tracking its commercial position.'
            : 'Create an Eco Audit, Solar Sense assessment, or Field App installation in Scheduler to start tracking its commercial position.'}
          icon="gauge"
        />
      ) : (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <FinanceJobPicker
            items={items}
            filtered={filtered}
            selectedJobKey={selectedJobKey}
            search={search}
            sourceApp={sourceApp}
            filterSourceApps={selectableFinanceSourceApps}
            exceptionFilter={exceptionFilter}
            hasNextPage={Boolean(overview.hasNextPage)}
            fetchingNextPage={overview.isFetchingNextPage}
            fetchNextPageError={overview.isFetchNextPageError ? overview.error : null}
            onSearch={setSearch}
            onSourceApp={setSourceApp}
            onExceptionFilter={setExceptionFilter}
            onLoadMore={loadMoreJobs}
            onSelect={(job) => {
              setSelectedJobKey(financeJobKey(job));
              if (typeof window !== 'undefined') {
                window.history.replaceState(null, '', schedulerFinanceHref({
                  view: 'financial-summary',
                  eventId: job.eventId ?? undefined,
                  financeId: job.financeId,
                  sourceApp: job.sourceApp,
                  sourceId: job.sourceId,
                }));
              }
            }}
          />
          <section className="min-w-0" aria-label="Selected job financial summary">
            {selected ? <SchedulerFinanceDetail key={selected.financeId} financeId={selected.financeId} overview={selected} /> : <EmptyState title="Select a job" description="Choose a job to review active hours, billing settings, rates, and profitability." icon="gauge" />}
          </section>
        </div>
      )}
    </div>
  );
}

function FinanceJobPicker({
  items,
  filtered,
  selectedJobKey,
  search,
  sourceApp,
  filterSourceApps,
  exceptionFilter,
  hasNextPage,
  fetchingNextPage,
  fetchNextPageError,
  onSearch,
  onSourceApp,
  onExceptionFilter,
  onLoadMore,
  onSelect,
}: {
  items: FinanceOverviewItem[];
  filtered: FinanceOverviewItem[];
  selectedJobKey: string | null;
  search: string;
  sourceApp: FinanceSourceApp | 'all';
  filterSourceApps: FinanceSourceApp[];
  exceptionFilter: FinanceExceptionFilter;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  fetchNextPageError: unknown;
  onSearch: (value: string) => void;
  onSourceApp: (value: FinanceSourceApp | 'all') => void;
  onExceptionFilter: (value: FinanceExceptionFilter) => void;
  onLoadMore: () => void;
  onSelect: (job: FinanceOverviewItem) => void;
}) {
  const exceptionCounts = financeExceptionCounts(items);
  return (
    <aside className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto" aria-label="Finance jobs">
      <div>
        <h2 className="font-extrabold text-[var(--text)]">Finance action queue</h2>
        <p className="mt-0.5 text-xs leading-5 text-[var(--text-sub)]">
          Prioritised from {items.length}{hasNextPage ? '+' : ''} loaded job summaries. Draft invoices are managed in the Invoices tab because draft status is not supplied per job here.
        </p>
      </div>
      <FinanceExceptionFilters
        counts={exceptionCounts}
        total={items.length}
        selected={exceptionFilter}
        onSelect={onExceptionFilter}
      />
      <label className="mt-4 block text-xs font-bold text-[var(--text-sub)]" htmlFor="finance-job-search">Find a site or job</label>
      <Input id="finance-job-search" type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="User, job, client, site, or address" className="mt-1 w-full" />
      <label className="mt-3 block text-xs font-bold text-[var(--text-sub)]" htmlFor="finance-app-filter">Product</label>
      <Select id="finance-app-filter" value={sourceApp} onChange={(event) => onSourceApp(event.target.value as FinanceSourceApp | 'all')} className="mt-1">
        <option value="all">All jobs</option>
        {filterSourceApps.map((app) => <option key={app} value={app}>{financeAppLabel(app)}</option>)}
      </Select>
      {hasNextPage && (search.trim() || sourceApp !== 'all' || exceptionFilter !== 'all') ? <p className="mt-3 text-xs leading-5 text-[var(--text-sub)]">Filters apply to loaded jobs. Load more to continue the search.</p> : null}
      <nav className="mt-3 space-y-2" aria-label="Financial summary jobs">
        {filtered.map((job) => {
          const selected = financeJobKey(job) === selectedJobKey;
          const exceptions = financeJobExceptionKinds(job).filter((kind) => kind !== 'unbilled');
          const tone = marginTone(job.marginPct);
          return (
            <button key={job.financeId} type="button" aria-current={selected ? 'true' : undefined} onClick={() => onSelect(job)} className={`block min-h-11 w-full rounded-xl border px-3 py-3 text-left transition-colors ${selected ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface2)]'}`}>
              <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate text-sm font-extrabold text-[var(--text)]">{job.jobName}</span><span className="mt-0.5 block text-xs text-[var(--text-sub)]">{financeAppLabel(job.sourceApp)} · {dateLabel(job.jobDate)}</span></span>{exceptions[0] ? <FinanceExceptionBadge kind={exceptions[0]} /> : null}</span>
              {exceptions.length > 1 ? (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {exceptions.slice(1).map((kind) => <FinanceExceptionBadge key={kind} kind={kind} />)}
                </span>
              ) : null}
              <span className="mt-2 flex items-end justify-between gap-2 text-xs"><span className="text-[var(--text-sub)]">Billable {money(job.billableAmount, job.currency)}</span><span className={`font-extrabold ${toneClasses[tone]}`}>{job.marginPct == null ? 'No margin' : `${job.marginPct.toFixed(1)}% margin`}</span></span>
            </button>
          );
        })}
        {!filtered.length ? <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--text-sub)]">No jobs match these filters.</p> : null}
        {hasNextPage ? <Button className="w-full" variant="secondary" disabled={fetchingNextPage} onClick={onLoadMore}>{fetchingNextPage ? 'Loading more jobs…' : 'Load more jobs'}</Button> : null}
        {fetchNextPageError ? <ErrorBanner message={cloudConnectionErrorMessage(fetchNextPageError)} /> : null}
      </nav>
    </aside>
  );
}

const financeExceptionLabels: Record<FinanceExceptionKind, string> = {
  overdue: 'Overdue',
  hours_review: 'Hours review',
  completed_without_invoice: 'Complete · no invoice',
  unbilled: 'Unbilled',
};

const financeExceptionBadgeClasses: Record<FinanceExceptionKind, string> = {
  overdue: 'bg-[var(--red-soft)] text-[var(--red)]',
  hours_review: 'bg-[var(--amber-soft)] text-[var(--amber)]',
  completed_without_invoice: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  unbilled: 'bg-[var(--surface2)] text-[var(--text-sub)]',
};

function FinanceExceptionFilters({
  counts,
  total,
  selected,
  onSelect,
}: {
  counts: Record<FinanceExceptionKind, number>;
  total: number;
  selected: FinanceExceptionFilter;
  onSelect: (filter: FinanceExceptionFilter) => void;
}) {
  const filters: Array<{ key: FinanceExceptionFilter; label: string; count: number }> = [
    { key: 'all', label: 'All jobs', count: total },
    { key: 'overdue', label: 'Overdue', count: counts.overdue },
    { key: 'completed_without_invoice', label: 'No invoice', count: counts.completed_without_invoice },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Finance exception filters">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          aria-pressed={selected === filter.key}
          onClick={() => onSelect(filter.key)}
          className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-bold transition-colors ${
            selected === filter.key
              ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]'
              : 'border-[var(--border)] bg-[var(--surface2)] text-[var(--text-sub)] hover:border-[var(--border-strong)]'
          }`}
        >
          <span className="block">{filter.label}</span>
          <span className="mt-0.5 block text-base font-extrabold">{filter.count}</span>
        </button>
      ))}
    </div>
  );
}

function FinanceExceptionBadge({ kind }: { kind: FinanceExceptionKind }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${financeExceptionBadgeClasses[kind]}`}>
      {financeExceptionLabels[kind]}
    </span>
  );
}
