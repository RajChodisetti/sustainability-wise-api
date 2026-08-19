'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorBanner, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { InvoiceDocument } from '@/modules/scheduler/components/InvoiceWorkspace';
import { startGlobalSchedulerInvoicePdfExport } from '@/modules/scheduler/api/client';
import {
  useCheckConsolidatedSchedulerInvoiceEligibility,
  useCreateConsolidatedSchedulerInvoice,
  useGlobalSchedulerInvoice,
  useGlobalSchedulerInvoices,
  useIssueGlobalSchedulerInvoice,
  useMarkGlobalSchedulerInvoicePaid,
  useUpdateGlobalSchedulerInvoice,
  useVoidGlobalSchedulerInvoice,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  consolidatedInvoiceJobSubtotal,
  financeAppLabel,
  invoiceStatusLabel,
  MAX_CONSOLIDATED_INVOICE_JOBS,
  schedulerFinanceHref,
  toggleConsolidatedInvoiceJob,
} from '@/modules/scheduler/lib/finance';
import type {
  FinanceOverviewItem,
  FinanceSourceApp,
  SchedulerGlobalInvoiceListItem,
  SchedulerInvoice,
  SchedulerInvoiceEligibility,
  SchedulerInvoiceStatus,
} from '@/modules/scheduler/types/domain';

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dateLabel(value: string | null): string {
  if (!value) return 'Not set';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isCompletedJobStatus(status: string): boolean {
  return status.trim().toLocaleLowerCase('en-AU') === 'completed';
}

const statusClasses = {
  draft: 'bg-[var(--surface2)] text-[var(--text-sub)]',
  issued: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  paid: 'bg-[var(--green-soft)] text-[var(--green)]',
  void: 'bg-[var(--red-soft)] text-[var(--red)]',
};

function StatusBadge({ invoice }: { invoice: Pick<SchedulerGlobalInvoiceListItem, 'status' | 'overdue'> }) {
  if (invoice.overdue && invoice.status === 'issued') return <span className="rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-xs font-extrabold text-[var(--red)]">Overdue</span>;
  return <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${statusClasses[invoice.status]}`}>{invoiceStatusLabel(invoice.status)}</span>;
}

export function SchedulerInvoicesWorkspace({
  jobs,
  visibleSourceApps,
  initialFinanceId,
  initialInvoiceId,
  hasMoreJobs,
  loadingMoreJobs,
  onLoadMoreJobs,
}: {
  jobs: FinanceOverviewItem[];
  visibleSourceApps: FinanceSourceApp[];
  initialFinanceId?: string;
  initialInvoiceId?: string;
  hasMoreJobs: boolean;
  loadingMoreJobs: boolean;
  onLoadMoreJobs: () => void;
}) {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(initialInvoiceId ?? null);
  const [builderMinimum, setBuilderMinimum] = useState<1 | 2 | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SchedulerInvoiceStatus | 'all' | 'overdue'>('all');
  const [sourceApp, setSourceApp] = useState<FinanceSourceApp | 'all'>('all');
  const deferredSearch = useDeferredValue(search);
  const query = useGlobalSchedulerInvoices({
    status: status === 'all' ? undefined : status === 'overdue' ? 'issued' : status,
    sourceApp: sourceApp === 'all' ? undefined : sourceApp,
    search: deferredSearch.trim() || undefined,
  });
  const invoices = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const currentJobStatuses = useMemo<Record<string, string>>(() => Object.fromEntries(
    jobs.map((job) => [job.financeId, job.jobStatus]),
  ), [jobs]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return invoices.filter((invoice) => {
      if (!invoice.sourceApps.every((app) => visibleSourceApps.includes(app))) return false;
      if (status === 'overdue' && !(invoice.overdue && invoice.status === 'issued')) return false;
      if (status !== 'all' && status !== 'overdue' && invoice.status !== status) return false;
      if (sourceApp !== 'all' && !invoice.sourceApps.includes(sourceApp)) return false;
      if (!needle) return true;
      return `${invoice.invoiceNumber} ${invoice.billToName} ${invoice.jobNames.join(' ')}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [invoices, search, sourceApp, status, visibleSourceApps]);

  function selectInvoice(invoiceId: string, financeId?: string) {
    setSelectedInvoiceId(invoiceId);
    setBuilderMinimum(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', schedulerFinanceHref({
        view: 'invoices',
        invoiceId,
        financeId,
      }));
    }
  }

  if (query.isLoading) return <Spinner label="Loading invoices…" />;
  if (query.error && invoices.length === 0) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;

  return (
    <div className="space-y-4">
      <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="global-invoices-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="global-invoices-heading" className="text-lg font-extrabold text-[var(--text)]">Invoice register</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-sub)]">All single-job and consolidated customer invoices in one audited register.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => setBuilderMinimum(1)}>New single-job invoice</Button>
            <Button className="w-full sm:w-auto" onClick={() => setBuilderMinimum(2)}>New consolidated invoice</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <FieldLabel className="!mt-0" htmlFor="invoice-register-search">Search</FieldLabel>
            <Input id="invoice-register-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Invoice, customer, or job" />
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="invoice-register-status">Status</FieldLabel>
            <Select id="invoice-register-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="void">Void</option></Select>
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="invoice-register-product">Product</FieldLabel>
            <Select id="invoice-register-product" value={sourceApp} onChange={(event) => setSourceApp(event.target.value as FinanceSourceApp | 'all')}>
              <option value="all">{visibleSourceApps.length === 1 ? 'All jobs' : 'All products'}</option>
              {visibleSourceApps.map((app) => <option key={app} value={app}>{financeAppLabel(app)}</option>)}
            </Select>
          </div>
        </div>
      </section>

      {builderMinimum ? (
        <ConsolidatedInvoiceBuilder
          minimumJobs={builderMinimum}
          jobs={jobs}
          initialFinanceId={initialFinanceId}
          hasMoreJobs={hasMoreJobs}
          loadingMoreJobs={loadingMoreJobs}
          onLoadMoreJobs={onLoadMoreJobs}
          onCancel={() => setBuilderMinimum(null)}
          onCreated={(invoice) => selectInvoice(invoice.id, invoice.financeIds?.[0] ?? invoice.financeId)}
        />
      ) : null}

      {invoices.length === 0 && !builderMinimum ? (
        <EmptyState title="No invoices yet" description="Use the actions above to create a single-job invoice or consolidate two or more compatible jobs for the same customer." icon="clipboard" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No invoices match these filters"
          description={query.hasNextPage ? 'No loaded issued invoices are overdue. Load more to continue the search.' : 'Change or clear a filter to see more invoices.'}
          icon="clipboard"
          actions={query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more invoices'}</Button> : undefined}
        />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <nav className="space-y-2 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto lg:pr-1" aria-label="Invoices">
            {filtered.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                aria-current={selectedInvoiceId === invoice.id ? 'true' : undefined}
                onClick={() => selectInvoice(invoice.id, invoice.financeIds[0])}
                className={`block min-h-11 w-full rounded-xl border p-3 text-left transition-colors ${selectedInvoiceId === invoice.id ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface2)]'}`}
              >
                <span className="flex items-center justify-between gap-2"><strong className="text-[var(--text)]">{invoice.invoiceNumber}</strong><StatusBadge invoice={invoice} /></span>
                <span className="mt-2 block truncate text-sm font-semibold text-[var(--text)]">{invoice.billToName || 'Billing name not set'}</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-sub)]">{invoice.jobCount} job{invoice.jobCount === 1 ? '' : 's'} · {invoice.jobNames.join(', ')}</span>
                <span className="mt-2 flex items-end justify-between gap-2 text-xs text-[var(--text-sub)]"><span>Due {dateLabel(invoice.dueDate)}</span><strong className="text-sm text-[var(--text)]">{money(invoice.totalIncGst, invoice.currency)}</strong></span>
              </button>
            ))}
            {query.hasNextPage ? <Button className="w-full" variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more invoices'}</Button> : null}
            {query.isFetchNextPageError ? <ErrorBanner message={cloudConnectionErrorMessage(query.error)} /> : null}
          </nav>
          <section className="min-w-0" aria-label="Selected invoice">
            {selectedInvoiceId ? (
              <GlobalInvoiceDetail key={selectedInvoiceId} invoiceId={selectedInvoiceId} currentJobStatuses={currentJobStatuses} onClose={() => {
                setSelectedInvoiceId(null);
                if (typeof window !== 'undefined') {
                  window.history.replaceState(null, '', schedulerFinanceHref({ view: 'invoices' }));
                }
              }} />
            ) : (
              <EmptyState title="Select an invoice" description="Choose an invoice to review its jobs, billing details, lifecycle, and PDF export." icon="clipboard" />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function GlobalInvoiceDetail({
  invoiceId,
  currentJobStatuses,
  onClose,
}: {
  invoiceId: string;
  currentJobStatuses: Readonly<Record<string, string>>;
  onClose: () => void;
}) {
  const query = useGlobalSchedulerInvoice(invoiceId);
  const update = useUpdateGlobalSchedulerInvoice();
  const issue = useIssueGlobalSchedulerInvoice();
  const markPaid = useMarkGlobalSchedulerInvoicePaid();
  const voidInvoice = useVoidGlobalSchedulerInvoice();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) return <Spinner label="Loading invoice detail…" />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Invoice not found." />;
  const invoice = query.data;

  return (
    <InvoiceDocument
      key={`${invoice.id}:${invoice.updatedAt}`}
      financeId={invoice.financeIds?.[0] ?? invoice.financeId}
      invoice={invoice}
      currentJobStatuses={currentJobStatuses}
      busy={update.isPending || issue.isPending || markPaid.isPending || voidInvoice.isPending}
      error={error}
      onClose={onClose}
      onRefresh={async () => { await query.refetch(); }}
      onStartPdf={() => startGlobalSchedulerInvoicePdfExport(invoice.id, invoice.updatedAt)}
      onSave={async (input) => {
        setError(null);
        try {
          await update.mutateAsync({ invoiceId, input: { ...input, expectedUpdatedAt: invoice.updatedAt } });
          toast.success('Draft invoice saved.');
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
      onIssue={async () => {
        if (!window.confirm(`Issue ${invoice.invoiceNumber}? The customer, jobs, and lines become an immutable billing snapshot.`)) return;
        setError(null);
        try {
          await issue.mutateAsync({ invoiceId, expectedUpdatedAt: invoice.updatedAt });
          toast.success(`${invoice.invoiceNumber} issued.`);
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
      onMarkPaid={async () => {
        setError(null);
        try {
          await markPaid.mutateAsync({ invoiceId, expectedUpdatedAt: invoice.updatedAt });
          toast.success(`${invoice.invoiceNumber} marked paid.`);
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
      onVoid={async () => {
        if (!window.confirm(`Void ${invoice.invoiceNumber}? Reserved charges from all ${invoice.jobCount ?? 1} jobs will be released.`)) return;
        setError(null);
        try {
          await voidInvoice.mutateAsync({ invoiceId, expectedUpdatedAt: invoice.updatedAt });
          toast.success(`${invoice.invoiceNumber} voided.`);
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
    />
  );
}

type JobSelection = { includeLabour: boolean; expenseIds: string[] };

function eligibilityIssueText(issue: SchedulerInvoiceEligibility['issues'][number]): string {
  return issue.message;
}

function ConsolidatedInvoiceBuilder({
  minimumJobs,
  jobs,
  initialFinanceId,
  hasMoreJobs,
  loadingMoreJobs,
  onLoadMoreJobs,
  onCancel,
  onCreated,
}: {
  minimumJobs: 1 | 2;
  jobs: FinanceOverviewItem[];
  initialFinanceId?: string;
  hasMoreJobs: boolean;
  loadingMoreJobs: boolean;
  onLoadMoreJobs: () => void;
  onCancel: () => void;
  onCreated: (invoice: SchedulerInvoice) => void;
}) {
  const eligibilityMutation = useCheckConsolidatedSchedulerInvoiceEligibility();
  const create = useCreateConsolidatedSchedulerInvoice();
  const toast = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => (
    initialFinanceId && jobs.some((job) => (
      job.financeId === initialFinanceId && isCompletedJobStatus(job.jobStatus)
    ))
      ? [initialFinanceId]
      : []
  ));
  const [jobSearch, setJobSearch] = useState('');
  const [eligibility, setEligibility] = useState<SchedulerInvoiceEligibility | null>(null);
  const [selections, setSelections] = useState<Record<string, JobSelection>>({});
  const [billToName, setBillToName] = useState('');
  const [billToAddress, setBillToAddress] = useState('');
  const [billToEmail, setBillToEmail] = useState('');
  const [billToAbn, setBillToAbn] = useState('');
  const [reference, setReference] = useState('');
  const [billToConfirmed, setBillToConfirmed] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const matchingJobs = useMemo(() => {
    const needle = jobSearch.trim().toLocaleLowerCase();
    return jobs.filter((job) => !needle || `${job.jobName} ${job.siteName} ${job.sourceId} ${financeAppLabel(job.sourceApp)}`.toLocaleLowerCase().includes(needle));
  }, [jobSearch, jobs]);

  async function review() {
    if (selectedIds.length < minimumJobs) {
      setError(minimumJobs === 2 ? 'Select at least two jobs for a consolidated invoice.' : 'Select one job to invoice.');
      return;
    }
    const incompleteJobs = jobs.filter((job) => (
      selectedIds.includes(job.financeId) && !isCompletedJobStatus(job.jobStatus)
    ));
    if (incompleteJobs.length > 0) {
      setError(`Complete ${incompleteJobs.map((job) => job.jobName).join(', ')} before creating an invoice.`);
      return;
    }
    setError(null);
    try {
      const result = await eligibilityMutation.mutateAsync(selectedIds);
      setEligibility(result);
      const initial: Record<string, JobSelection> = {};
      for (const job of result.jobs) {
        initial[job.financeId] = {
          includeLabour: (job.pricingMode === 'quoted' ? job.availableQuotedAmount : job.availableLabourAmount ?? 0) > 0,
          expenseIds: job.availableExpenses.map((expense) => expense.id),
        };
      }
      setSelections(initial);
      const firstBilling = result.jobs[0]?.billing;
      setBillToName(firstBilling?.name ?? '');
      setBillToAddress(firstBilling?.address ?? '');
      setBillToEmail(firstBilling?.email ?? '');
      setBillToAbn(firstBilling?.abn ?? '');
      setReference(firstBilling?.reference ?? '');
      setBillToConfirmed(!result.requiresExplicitBillTo);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  const subtotal = eligibility?.jobs.reduce((sum, job) => (
    sum + consolidatedInvoiceJobSubtotal(job, selections[job.financeId] ?? { includeLabour: false, expenseIds: [] })
  ), 0) ?? 0;
  const gstRate = eligibility?.gstRate ?? 0.1;
  const gst = Math.round((subtotal * gstRate + Number.EPSILON) * 100) / 100;
  const total = subtotal + gst;
  async function createDraft() {
    if (!eligibility?.eligible) {
      setError('Resolve the eligibility issues before creating this draft.');
      return;
    }
    if (!billToName.trim()) {
      setError('Enter the invoice recipient name.');
      return;
    }
    if (eligibility.requiresExplicitBillTo && !billToConfirmed) {
      setError('Confirm the billing recipient selected for these jobs.');
      return;
    }
    setError(null);
    try {
      const invoice = await create.mutateAsync({
        jobs: eligibility.jobs.map((job) => ({
          financeId: job.financeId,
          includeLabour: selections[job.financeId]?.includeLabour ?? false,
          expenseIds: selections[job.financeId]?.expenseIds ?? [],
        })),
        billTo: {
          name: billToName.trim(),
          address: billToAddress.trim() || null,
          email: billToEmail.trim() || null,
          abn: billToAbn.trim() || null,
          purchaseOrderReference: reference.trim() || null,
        },
        notes: notes.trim() || null,
      });
      toast.success(`Draft ${invoice.invoiceNumber} created for ${invoice.jobCount ?? eligibility.jobs.length} job${(invoice.jobCount ?? eligibility.jobs.length) === 1 ? '' : 's'}.`);
      onCreated(invoice);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5" aria-labelledby="invoice-builder-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="invoice-builder-heading" className="font-extrabold text-[var(--text)]">{minimumJobs === 2 ? 'New consolidated invoice' : 'New single-job invoice'}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">{eligibility ? 'Choose the charges for each job, resolve one billing recipient, and review the consolidated totals.' : minimumJobs === 2 ? 'Select two or more jobs. Currency, billing identity, and invoiceable balances are checked before draft creation.' : 'Select a job and review its available invoice charges.'}</p></div><Button variant="ghost" disabled={eligibilityMutation.isPending || create.isPending} onClick={onCancel}>Close</Button></div>

      {!eligibility ? (
        <>
          <FieldLabel htmlFor="invoice-job-search">Find jobs</FieldLabel>
          <Input id="invoice-job-search" type="search" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Job, site, product, or ID" />
          <p className="mt-2 text-sm font-bold text-[var(--text)]" aria-live="polite">{selectedIds.length} / {MAX_CONSOLIDATED_INVOICE_JOBS} selected {minimumJobs === 2 ? '· minimum 2' : ''}</p>
          <fieldset className="mt-2 grid min-w-0 max-h-[28rem] w-full gap-2 overflow-y-auto rounded-xl border border-[var(--border)] p-2 sm:grid-cols-2 xl:grid-cols-3">
            <legend className="sr-only">Jobs to invoice</legend>
            {matchingJobs.map((job) => {
              const selected = selectedIds.includes(job.financeId);
              const completed = isCompletedJobStatus(job.jobStatus);
              return (
                <label key={job.financeId} className={`flex min-h-28 min-w-0 items-start gap-3 rounded-xl border p-3 transition-colors ${!completed ? 'cursor-not-allowed border-[var(--border)] bg-[var(--surface2)] opacity-70' : selected ? 'cursor-pointer border-[var(--primary)] bg-[var(--primary-soft)]' : 'cursor-pointer border-[var(--border)] hover:bg-[var(--surface2)]'}`}>
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]" checked={selected} disabled={!completed} onChange={(event) => {
                    const result = toggleConsolidatedInvoiceJob(selectedIds, job.financeId, event.target.checked);
                    setSelectedIds(result.financeIds);
                    setError(result.atLimit ? `A single invoice can include up to ${MAX_CONSOLIDATED_INVOICE_JOBS} jobs.` : null);
                  }} />
                  <span className="min-w-0">
                    <strong className="block truncate text-base leading-6 text-[var(--text)]">{job.jobName}</strong>
                    <span className="block truncate text-xs leading-5 text-[var(--text-sub)]">{job.siteName || 'Site not set'}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-sub)]">{financeAppLabel(job.sourceApp)} · {job.currency} · {money(job.unbilledAmount, job.currency)} unbilled</span>
                    {!completed ? <span className="mt-1 block text-xs font-bold text-[var(--amber)]">Complete this job before invoicing</span> : job.needsHoursReview ? <span className="mt-1 block text-xs font-bold text-[var(--amber)]">Internal billing setup needs review</span> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {matchingJobs.length === 0 ? <p className="mt-3 text-center text-sm text-[var(--text-sub)]">No jobs match this search.</p> : null}
          {hasMoreJobs ? <Button className="mt-3" variant="secondary" disabled={loadingMoreJobs} onClick={onLoadMoreJobs}>{loadingMoreJobs ? 'Loading jobs…' : 'Load more jobs'}</Button> : null}
          {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button className="w-full sm:w-auto" variant="secondary" disabled={eligibilityMutation.isPending} onClick={onCancel}>Cancel</Button><Button className="w-full sm:w-auto" disabled={eligibilityMutation.isPending || selectedIds.length < minimumJobs} aria-busy={eligibilityMutation.isPending} onClick={() => void review()}>{eligibilityMutation.isPending ? 'Checking jobs…' : 'Review invoice'}</Button></div>
        </>
      ) : (
        <>
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${eligibility.eligible ? 'border-[var(--green)]/30 bg-[var(--green-soft)] text-[var(--green)]' : 'border-[var(--red)]/30 bg-[var(--red-soft)] text-[var(--red)]'}`} role="status"><strong>{eligibility.eligible ? 'Jobs can be invoiced together.' : 'These jobs cannot be invoiced together yet.'}</strong><span className="mt-1 block">{eligibility.commonCurrency ? `${eligibility.commonCurrency} · ${eligibility.jobs.length} compatible job${eligibility.jobs.length === 1 ? '' : 's'}` : 'The selected jobs do not share one invoice currency.'}</span></div>
          {eligibility.issues.length > 0 ? <ul className="mt-3 space-y-2" aria-label="Invoice eligibility issues">{eligibility.issues.map((issue, index) => <li key={`${eligibilityIssueText(issue)}-${index}`} className="rounded-lg border border-[var(--amber)]/25 bg-[var(--amber-soft)] px-3 py-2 text-sm font-semibold text-[var(--amber)]">{eligibilityIssueText(issue)}</li>)}</ul> : null}

          <div className="mt-4 space-y-3">
            {eligibility.jobs.map((job) => {
              const selection = selections[job.financeId] ?? { includeLabour: false, expenseIds: [] };
              const labourAmount = job.pricingMode === 'quoted' ? job.availableQuotedAmount : job.availableLabourAmount ?? 0;
              return (
                <fieldset key={job.financeId} className="rounded-xl border border-[var(--border)] p-4">
                  <legend className="px-1 text-base font-extrabold leading-6 text-[var(--text)]">{job.job.jobName}</legend>
                  <p className="truncate text-xs leading-5 text-[var(--text-sub)]">{job.job.siteName || 'Site not set'}</p>
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-[var(--text-sub)]"><span>{financeAppLabel(job.source.sourceApp)} · {job.currency}</span><strong className="text-sm text-[var(--text)]">{money(consolidatedInvoiceJobSubtotal(job, selection), job.currency)} selected</strong></div>
                  <Checkbox label={`${job.pricingMode === 'quoted' ? 'Remaining quote' : 'Suggested labour charge'} · ${money(labourAmount, job.currency)}`} checked={selection.includeLabour} disabled={labourAmount <= 0} onChange={(includeLabour) => setSelections((current) => ({ ...current, [job.financeId]: { ...selection, includeLabour } }))} />
                  {job.pricingMode === 'charge_up' && labourAmount > 0 ? <FieldHint>The labour suggestion can be edited or removed in the draft. Quantity and rate are hidden by default.</FieldHint> : null}
                  {job.availableExpenses.length ? <div className="grid gap-x-4 sm:grid-cols-2">{job.availableExpenses.map((expense) => <Checkbox key={expense.id} label={`${expense.description} · ${money(expense.effectiveBillableAmount, job.currency)}`} checked={selection.expenseIds.includes(expense.id)} onChange={(checked) => setSelections((current) => ({ ...current, [job.financeId]: { ...selection, expenseIds: checked ? [...selection.expenseIds, expense.id] : selection.expenseIds.filter((id) => id !== expense.id) } }))} />)}</div> : <p className="mt-2 text-xs text-[var(--text-sub)]">No uninvoiced billable expenses.</p>}
                  {consolidatedInvoiceJobSubtotal(job, selection) <= 0 ? <p className="mt-2 rounded-lg bg-[var(--surface2)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--text-sub)]">No suggested charge selected. You can add a custom charge for this job in the draft.</p> : null}
                </fieldset>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="rounded-xl border border-[var(--border)] p-4">
              <h3 className="font-extrabold text-[var(--text)]">Billing recipient</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">One recipient is used for the consolidated invoice. Review these details even when the jobs currently match.</p>
              <div className="grid gap-x-3 sm:grid-cols-2"><div><FieldLabel htmlFor="consolidated-bill-name">Recipient name</FieldLabel><Input id="consolidated-bill-name" value={billToName} onChange={(event) => setBillToName(event.target.value)} /></div><div><FieldLabel htmlFor="consolidated-bill-email">Email</FieldLabel><Input id="consolidated-bill-email" type="email" value={billToEmail} onChange={(event) => setBillToEmail(event.target.value)} /></div><div><FieldLabel htmlFor="consolidated-bill-abn">Recipient ABN</FieldLabel><Input id="consolidated-bill-abn" inputMode="numeric" value={billToAbn} onChange={(event) => setBillToAbn(event.target.value)} /></div><div><FieldLabel htmlFor="consolidated-bill-reference">PO / reference</FieldLabel><Input id="consolidated-bill-reference" value={reference} onChange={(event) => setReference(event.target.value)} /></div><div className="sm:col-span-2"><FieldLabel htmlFor="consolidated-bill-address">Address</FieldLabel><Textarea id="consolidated-bill-address" rows={3} value={billToAddress} onChange={(event) => setBillToAddress(event.target.value)} /></div></div>
              <p className="mt-3 text-xs leading-5 text-[var(--text-sub)]">Recipient name is required. Address and ABN are optional identifiers that can be retained on the invoice snapshot.</p>
              {eligibility.requiresExplicitBillTo ? <Checkbox label="I have resolved the billing mismatch and confirmed this recipient for every selected job" checked={billToConfirmed} onChange={setBillToConfirmed} /> : null}
              <FieldLabel htmlFor="consolidated-notes">Invoice notes</FieldLabel><Textarea id="consolidated-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
            <aside className="h-fit rounded-xl border border-[var(--border-strong)] bg-[var(--surface2)] p-4" aria-label="Invoice total review"><h3 className="font-extrabold text-[var(--text)]">Invoice total</h3><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-[var(--text-sub)]">Jobs</dt><dd className="font-bold">{eligibility.jobs.length}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--text-sub)]">Subtotal ex GST</dt><dd className="font-bold">{money(subtotal, eligibility.commonCurrency ?? 'AUD')}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--text-sub)]">GST ({(gstRate * 100).toFixed(0)}%)</dt><dd className="font-bold">{money(gst, eligibility.commonCurrency ?? 'AUD')}</dd></div><div className="flex justify-between gap-3 border-t border-[var(--border)] pt-3"><dt className="font-extrabold text-[var(--text)]">Total inc GST</dt><dd className="text-lg font-extrabold text-[var(--text)]">{money(total, eligibility.commonCurrency ?? 'AUD')}</dd></div></dl><FieldHint>The API recalculates and validates every amount when the draft is created.</FieldHint></aside>
          </div>
          {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><Button className="w-full sm:w-auto" variant="secondary" disabled={create.isPending} onClick={() => { setEligibility(null); setError(null); }}>Back to jobs</Button><div className="flex flex-col-reverse gap-2 sm:flex-row"><Button className="w-full sm:w-auto" variant="secondary" disabled={create.isPending} onClick={onCancel}>Cancel</Button><Button className="w-full sm:w-auto" disabled={create.isPending || !eligibility.eligible} aria-busy={create.isPending} onClick={() => void createDraft()}>{create.isPending ? 'Creating draft…' : `Create ${eligibility.jobs.length > 1 ? 'consolidated ' : ''}draft`}</Button></div></div>
        </>
      )}
    </section>
  );
}
