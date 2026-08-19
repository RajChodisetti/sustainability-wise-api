'use client';

import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button, buttonClassName } from '@/components/ui/Button';
import { EmptyState, ErrorBanner, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import {
  downloadSchedulerExpenseAttachment,
} from '@/modules/scheduler/api/client';
import {
  useCreateGlobalSchedulerExpense,
  useDeleteGlobalSchedulerExpense,
  useDeleteSchedulerExpenseAttachment,
  useGlobalSchedulerExpenses,
  useUpdateGlobalSchedulerExpense,
  useUploadSchedulerExpenseAttachment,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  billAttachmentValidation,
  financeAppLabel,
  persistExpenseBeforeAttachment,
} from '@/modules/scheduler/lib/finance';
import type {
  FinanceExpenseCategory,
  FinanceExpenseInput,
  FinanceExpenseKind,
  FinanceOverviewItem,
  FinanceSourceApp,
  SchedulerGlobalExpense,
} from '@/modules/scheduler/types/domain';

const categories: Array<{ value: FinanceExpenseCategory; label: string }> = [
  { value: 'materials', label: 'Materials' },
  { value: 'travel', label: 'Travel' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
];

type CostForm = {
  financeId: string;
  kind: FinanceExpenseKind;
  category: FinanceExpenseCategory;
  description: string;
  vendor: string;
  reference: string;
  incurredAt: string;
  costAmount: string;
  billableAmount: string;
  billable: boolean;
  file: File | null;
};

function emptyForm(financeId = '', mode: 'manual' | 'upload' = 'manual'): CostForm {
  return {
    financeId,
    kind: mode === 'upload' ? 'supplier_bill' : 'expense',
    category: 'materials',
    description: '',
    vendor: '',
    reference: '',
    incurredAt: '',
    costAmount: '',
    billableAmount: '',
    billable: true,
    file: null,
  };
}

function formFromExpense(expense: SchedulerGlobalExpense): CostForm {
  return {
    financeId: expense.financeId,
    kind: expense.kind,
    category: expense.category,
    description: expense.description,
    vendor: expense.vendor ?? '',
    reference: expense.reference ?? '',
    incurredAt: expense.incurredAt?.slice(0, 10) ?? '',
    costAmount: String(expense.costAmount),
    billableAmount: expense.billableAmount == null ? '' : String(expense.billableAmount),
    billable: expense.billable,
    file: null,
  };
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dateLabel(value: string | null): string {
  if (!value) return 'Date not set';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function SchedulerBillsWorkspace({
  jobs,
  visibleSourceApps,
  filterSourceApps,
  initialFinanceId,
  hasMoreJobs,
  loadingMoreJobs,
  onLoadMoreJobs,
}: {
  jobs: FinanceOverviewItem[];
  visibleSourceApps: FinanceSourceApp[];
  filterSourceApps: FinanceSourceApp[];
  initialFinanceId?: string;
  hasMoreJobs: boolean;
  loadingMoreJobs: boolean;
  onLoadMoreJobs: () => void;
}) {
  const create = useCreateGlobalSchedulerExpense();
  const update = useUpdateGlobalSchedulerExpense();
  const remove = useDeleteGlobalSchedulerExpense();
  const upload = useUploadSchedulerExpenseAttachment();
  const deleteAttachment = useDeleteSchedulerExpenseAttachment();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [sourceApp, setSourceApp] = useState<FinanceSourceApp | 'all'>('all');
  const [kind, setKind] = useState<FinanceExpenseKind | 'all'>('all');
  const [state, setState] = useState<'all' | 'open' | 'reserved' | 'invoiced'>('all');
  const [attachmentState, setAttachmentState] = useState<'all' | 'with' | 'without'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [formMode, setFormMode] = useState<'manual' | 'upload' | null>(null);
  const [editing, setEditing] = useState<SchedulerGlobalExpense | null>(null);
  const [form, setForm] = useState<CostForm>(emptyForm(initialFinanceId));
  const [error, setError] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const query = useGlobalSchedulerExpenses({
    kind: kind === 'all' ? undefined : kind,
    sourceApp: sourceApp === 'all' ? undefined : sourceApp,
    search: deferredSearch.trim() || undefined,
  });
  const busy = create.isPending || update.isPending || upload.isPending;

  const expenses = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return expenses.filter((expense) => {
      if (!visibleSourceApps.includes(expense.source.sourceApp)) return false;
      if (sourceApp !== 'all' && expense.source.sourceApp !== sourceApp) return false;
      if (kind !== 'all' && expense.kind !== kind) return false;
      if (state === 'open' && (expense.invoiced || expense.reserved)) return false;
      if (state === 'reserved' && !expense.reserved) return false;
      if (state === 'invoiced' && !expense.invoiced) return false;
      const attachments = expense.attachments ?? [];
      if (attachmentState === 'with' && attachments.length === 0) return false;
      if (attachmentState === 'without' && attachments.length > 0) return false;
      const incurred = expense.incurredAt?.slice(0, 10) ?? '';
      if (dateFrom && (!incurred || incurred < dateFrom)) return false;
      if (dateTo && (!incurred || incurred > dateTo)) return false;
      if (!needle) return true;
      return `${expense.job.jobName} ${expense.description} ${expense.vendor ?? ''} ${expense.reference ?? ''} ${financeAppLabel(expense.source.sourceApp)}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [attachmentState, dateFrom, dateTo, expenses, kind, search, sourceApp, state, visibleSourceApps]);

  function openNew(mode: 'manual' | 'upload') {
    setEditing(null);
    setForm(emptyForm(initialFinanceId ?? jobs[0]?.financeId ?? '', mode));
    setError(null);
    setFormMode(mode);
  }

  function openEdit(expense: SchedulerGlobalExpense) {
    setEditing(expense);
    setForm(formFromExpense(expense));
    setError(null);
    setFormMode('manual');
  }

  function closeForm() {
    setEditing(null);
    setFormMode(null);
    setForm(emptyForm(initialFinanceId ?? jobs[0]?.financeId ?? ''));
    setError(null);
  }

  function normalizedInput(): FinanceExpenseInput | null {
    const costAmount = Number(form.costAmount);
    const billableAmount = form.billableAmount.trim() ? Number(form.billableAmount) : null;
    if (!form.financeId) {
      setError('Choose the job this cost belongs to.');
      return null;
    }
    if (!form.description.trim()) {
      setError('Add a description for this expense or supplier bill.');
      return null;
    }
    if (!Number.isFinite(costAmount) || costAmount < 0) {
      setError('Cost amount must be a valid amount of zero or more.');
      return null;
    }
    if (billableAmount != null && (!Number.isFinite(billableAmount) || billableAmount < 0)) {
      setError('Sell amount must be a valid amount of zero or more.');
      return null;
    }
    return {
      kind: form.kind,
      category: form.category,
      description: form.description.trim(),
      vendor: form.vendor.trim() || null,
      reference: form.reference.trim() || null,
      incurredAt: form.incurredAt || null,
      costAmount,
      billable: form.billable,
      billableAmount: form.billable ? billableAmount : null,
    };
  }

  async function saveCost() {
    setError(null);
    const input = normalizedInput();
    if (!input) return;
    if (formMode === 'upload') {
      if (!form.file) {
        setError('Choose the bill file to upload.');
        return;
      }
      const fileIssue = billAttachmentValidation(form.file);
      if (fileIssue) {
        setError(fileIssue);
        return;
      }
    }
    try {
      if (editing) {
        await update.mutateAsync({ financeId: editing.financeId, expenseId: editing.id, input });
        toast.success('Cost updated.');
        closeForm();
      } else {
        const attachment = formMode === 'upload' ? form.file : null;
        const result = await persistExpenseBeforeAttachment({
          create: () => create.mutateAsync({ financeId: form.financeId, input }),
          onPersisted: closeForm,
          upload: attachment
            ? async (expense) => { await upload.mutateAsync({ expenseId: expense.id, file: attachment }); }
            : undefined,
        });
        if (result.attachmentError) {
          setError(`The supplier bill was saved, but its attachment failed to upload. Use “Attach bill” on the saved row to retry. ${cloudConnectionErrorMessage(result.attachmentError)}`);
          toast.error('Bill saved; attachment failed.');
          return;
        }
        const savedMessage = formMode === 'upload'
          ? 'Supplier bill and attachment saved.'
          : 'Cost added.';
        toast.success(result.expense.invoiceId
          ? `${savedMessage} Added to the existing draft invoice.`
          : savedMessage);
      }
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  async function uploadToExpense(expense: SchedulerGlobalExpense, file?: File) {
    if (!file) return;
    const fileIssue = billAttachmentValidation(file);
    if (fileIssue) {
      setError(fileIssue);
      return;
    }
    setRowBusyId(expense.id);
    setError(null);
    try {
      await upload.mutateAsync({ expenseId: expense.id, file });
      toast.success('Bill attachment uploaded.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    } finally {
      setRowBusyId(null);
    }
  }

  async function downloadAttachment(expense: SchedulerGlobalExpense, attachmentId: string, filename: string) {
    setRowBusyId(expense.id);
    setError(null);
    try {
      saveBlob(await downloadSchedulerExpenseAttachment(expense.id, attachmentId), filename);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    } finally {
      setRowBusyId(null);
    }
  }

  async function removeAttachment(expense: SchedulerGlobalExpense, attachmentId: string, filename: string) {
    if (!window.confirm(`Delete attachment “${filename}”? The cost record will remain.`)) return;
    setRowBusyId(expense.id);
    setError(null);
    try {
      await deleteAttachment.mutateAsync({ expenseId: expense.id, attachmentId });
      toast.success('Bill attachment deleted.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    } finally {
      setRowBusyId(null);
    }
  }

  async function deleteCost(expense: SchedulerGlobalExpense) {
    if (!window.confirm(`Delete “${expense.description}” from the active cost ledger?`)) return;
    setRowBusyId(expense.id);
    setError(null);
    try {
      await remove.mutateAsync({ financeId: expense.financeId, expenseId: expense.id });
      toast.success('Cost deleted.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    } finally {
      setRowBusyId(null);
    }
  }

  if (query.isLoading) return <Spinner label="Loading bills and expenses…" />;
  if (query.error && expenses.length === 0) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;

  return (
    <div className="space-y-4">
      <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="bills-ledger-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="bills-ledger-heading" className="text-lg font-extrabold text-[var(--text)]">Bills and expenses ledger</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-sub)]">Structured costs and private supplier evidence for every Scheduler job.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button className="w-full sm:w-auto" type="button" variant="secondary" onClick={() => openNew('manual')}>Add manually</Button>
            <Button className="w-full sm:w-auto" type="button" onClick={() => openNew('upload')}>Upload bill</Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6" aria-label="Bill filters">
          <div className="sm:col-span-2">
            <FieldLabel className="!mt-0" htmlFor="bill-search">Search</FieldLabel>
            <Input id="bill-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Job, vendor, reference, or description" />
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="bill-app-filter">Product</FieldLabel>
            <Select id="bill-app-filter" value={sourceApp} onChange={(event) => setSourceApp(event.target.value as FinanceSourceApp | 'all')}>
              <option value="all">All jobs</option>
              {filterSourceApps.map((app) => <option key={app} value={app}>{financeAppLabel(app)}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="bill-kind-filter">Type</FieldLabel>
            <Select id="bill-kind-filter" value={kind} onChange={(event) => setKind(event.target.value as FinanceExpenseKind | 'all')}>
              <option value="all">All types</option>
              <option value="supplier_bill">Supplier bills</option>
              <option value="expense">Expenses</option>
            </Select>
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="bill-state-filter">Invoice state</FieldLabel>
            <Select id="bill-state-filter" value={state} onChange={(event) => setState(event.target.value as typeof state)}>
              <option value="all">All states</option>
              <option value="open">Available</option>
              <option value="reserved">In draft</option>
              <option value="invoiced">Invoiced</option>
            </Select>
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="bill-attachment-filter">Attachment</FieldLabel>
            <Select id="bill-attachment-filter" value={attachmentState} onChange={(event) => setAttachmentState(event.target.value as typeof attachmentState)}>
              <option value="all">Any</option>
              <option value="with">Attached</option>
              <option value="without">Missing</option>
            </Select>
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="bill-date-from">From</FieldLabel>
            <Input id="bill-date-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div>
            <FieldLabel className="!mt-0" htmlFor="bill-date-to">To</FieldLabel>
            <Input id="bill-date-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
        </div>
      </section>

      {formMode ? (
        <CostEditor
          mode={formMode}
          editing={editing}
          form={form}
          setForm={setForm}
          jobs={jobs}
          hasMoreJobs={hasMoreJobs}
          loadingMoreJobs={loadingMoreJobs}
          onLoadMoreJobs={onLoadMoreJobs}
          busy={busy}
          error={error}
          fileInputRef={fileInputRef}
          onCancel={closeForm}
          onSave={() => void saveCost()}
        />
      ) : null}

      {!formMode && error ? <ErrorBanner message={error} /> : null}

      {expenses.length === 0 ? (
        <EmptyState title="No bills or expenses yet" description="Use the actions above to add a job cost manually or upload a supplier bill." icon="clipboard" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No costs match these filters"
          description={query.hasNextPage ? 'No loaded entries match the invoice, date, or attachment filters. Load more to continue the search.' : 'Change or clear a filter to see more ledger entries.'}
          icon="clipboard"
          actions={query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more costs'}</Button> : undefined}
        />
      ) : (
        <>
          <div className="space-y-3 lg:hidden">
            {filtered.map((expense) => (
              <BillCard key={expense.id} expense={expense} busy={rowBusyId === expense.id} onEdit={openEdit} onUpload={uploadToExpense} onDownload={downloadAttachment} onDeleteAttachment={removeAttachment} onDelete={deleteCost} />
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] lg:block">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] bg-[var(--surface2)] text-xs uppercase tracking-wide text-[var(--text-sub)]"><th className="px-4 py-3">Job</th><th className="px-3 py-3">Bill / expense</th><th className="px-3 py-3">Vendor</th><th className="px-3 py-3">Date</th><th className="px-3 py-3 text-right">Cost</th><th className="px-3 py-3 text-right">Billable</th><th className="px-3 py-3">Evidence</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>{filtered.map((expense) => <BillRow key={expense.id} expense={expense} busy={rowBusyId === expense.id} onEdit={openEdit} onUpload={uploadToExpense} onDownload={downloadAttachment} onDeleteAttachment={removeAttachment} onDelete={deleteCost} />)}</tbody>
            </table>
          </div>
        </>
      )}

      {(query.hasNextPage || query.isFetchNextPageError) ? (
        <div className="flex flex-col items-center gap-2">
          {query.isFetchNextPageError ? <ErrorBanner message={cloudConnectionErrorMessage(query.error)} /> : null}
          {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more bills and expenses'}</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

function CostEditor({
  mode,
  editing,
  form,
  setForm,
  jobs,
  hasMoreJobs,
  loadingMoreJobs,
  onLoadMoreJobs,
  busy,
  error,
  fileInputRef,
  onCancel,
  onSave,
}: {
  mode: 'manual' | 'upload';
  editing: SchedulerGlobalExpense | null;
  form: CostForm;
  setForm: (form: CostForm) => void;
  jobs: FinanceOverviewItem[];
  hasMoreJobs: boolean;
  loadingMoreJobs: boolean;
  onLoadMoreJobs: () => void;
  busy: boolean;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5" aria-labelledby="cost-editor-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cost-editor-heading" className="font-extrabold text-[var(--text)]">{editing ? 'Edit cost' : mode === 'upload' ? 'Upload supplier bill' : 'Add cost manually'}</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">{mode === 'upload' && !editing ? 'Save the structured cost and its private source document together.' : 'Record the commercial details against one Scheduler job.'}</p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Close</Button>
      </div>
      <div className="mt-2 grid gap-x-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="md:col-span-2 xl:col-span-3">
          <p id="global-cost-job-label" className="mt-3 text-sm font-bold text-[var(--text)]">Job</p>
          {editing ? (
            <div className="mt-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface2)] px-4 py-3">
              <strong className="block text-lg font-extrabold leading-tight text-[var(--text)]">{editing.job.jobName}</strong>
              <span className="mt-1 block text-xs font-semibold text-[var(--text-sub)]">{editing.job.siteName || 'Site name not set'}</span>
              <span className="mt-1 block text-[11px] uppercase tracking-wide text-[var(--text-sub)]">{financeAppLabel(editing.source.sourceApp)} · {editing.currency}</span>
            </div>
          ) : (
            <div id="global-cost-job-picker" role="radiogroup" aria-labelledby="global-cost-job-label" className="mt-1 grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-[var(--border)] p-2 sm:grid-cols-2">
              {jobs.map((job) => (
                <label key={job.financeId} className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-[var(--focus)] ${form.financeId === job.financeId ? 'border-[var(--blue)] bg-[var(--blue-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]'}`}>
                  <input
                    className="sr-only"
                    type="radio"
                    name="global-cost-job"
                    value={job.financeId}
                    checked={form.financeId === job.financeId}
                    onChange={() => setForm({ ...form, financeId: job.financeId })}
                  />
                  <strong className="block text-base font-extrabold leading-tight text-[var(--text)]">{job.jobName}</strong>
                  <span className="mt-1 block text-xs font-semibold text-[var(--text-sub)]">{job.siteName || 'Site name not set'}</span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-[var(--text-sub)]">{financeAppLabel(job.sourceApp)} · {job.currency}</span>
                </label>
              ))}
              {jobs.length === 0 ? <p className="p-3 text-sm text-[var(--text-sub)]">No Scheduler jobs are available.</p> : null}
            </div>
          )}
          {hasMoreJobs ? <Button type="button" className="mt-2" variant="ghost" disabled={loadingMoreJobs} onClick={onLoadMoreJobs}>{loadingMoreJobs ? 'Loading jobs…' : 'Load more jobs'}</Button> : null}
        </div>
        {mode === 'upload' && !editing ? (
          <div className="md:col-span-2 xl:col-span-3">
            <FieldLabel htmlFor="global-cost-file">Bill attachment</FieldLabel>
            <input ref={fileInputRef} id="global-cost-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => setForm({ ...form, file: event.target.files?.[0] ?? null })} />
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="global-cost-file" className={buttonClassName('secondary', 'cursor-pointer')}>{form.file ? 'Choose another file' : 'Choose bill file'}</label>
              <span className="min-w-0 truncate text-sm text-[var(--text-sub)]">{form.file ? `${form.file.name} · ${(form.file.size / 1024 / 1024).toFixed(2)} MB` : 'No file selected'}</span>
            </div>
            <FieldHint>PDF, JPEG, PNG, or WebP up to 10 MB. Attachments remain private and require an active admin session to download.</FieldHint>
          </div>
        ) : null}
        <div>
          <FieldLabel htmlFor="global-cost-kind">Record type</FieldLabel>
          <Select id="global-cost-kind" value={form.kind} disabled={mode === 'upload' && !editing} onChange={(event) => setForm({ ...form, kind: event.target.value as FinanceExpenseKind })}><option value="expense">Expense</option><option value="supplier_bill">Supplier bill</option></Select>
        </div>
        <div>
          <FieldLabel htmlFor="global-cost-category">Category</FieldLabel>
          <Select id="global-cost-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as FinanceExpenseCategory })}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</Select>
        </div>
        <div>
          <FieldLabel htmlFor="global-cost-date">Date</FieldLabel>
          <Input id="global-cost-date" type="date" value={form.incurredAt} onChange={(event) => setForm({ ...form, incurredAt: event.target.value })} />
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <FieldLabel htmlFor="global-cost-description">Description</FieldLabel>
          <Input id="global-cost-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Materials, travel, subcontractor work…" />
        </div>
        <div>
          <FieldLabel htmlFor="global-cost-vendor">Vendor</FieldLabel>
          <Input id="global-cost-vendor" value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} />
        </div>
        <div>
          <FieldLabel htmlFor="global-cost-reference">Reference / bill number</FieldLabel>
          <Input id="global-cost-reference" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </div>
        <div>
          <FieldLabel htmlFor="global-cost-amount">Cost (ex GST)</FieldLabel>
          <Input id="global-cost-amount" type="number" min="0" step="0.01" inputMode="decimal" value={form.costAmount} onChange={(event) => setForm({ ...form, costAmount: event.target.value })} />
        </div>
        <div>
          <FieldLabel htmlFor="global-cost-sell">Sell (ex GST)</FieldLabel>
          <Input id="global-cost-sell" type="number" min="0" step="0.01" inputMode="decimal" disabled={!form.billable} value={form.billableAmount} onChange={(event) => setForm({ ...form, billableAmount: event.target.value })} />
          <FieldHint>Leave blank to bill this cost at cost.</FieldHint>
        </div>
        <div className="self-end">
          <Checkbox label="Billable to customer" checked={form.billable} onChange={(billable) => setForm({ ...form, billable })} />
        </div>
      </div>
      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button className="w-full sm:w-auto" disabled={busy} aria-busy={busy} onClick={onSave}>{busy ? 'Saving…' : editing ? 'Save changes' : mode === 'upload' ? 'Save and upload bill' : 'Add cost'}</Button>
      </div>
    </section>
  );
}

type BillActions = {
  expense: SchedulerGlobalExpense;
  busy: boolean;
  onEdit: (expense: SchedulerGlobalExpense) => void;
  onUpload: (expense: SchedulerGlobalExpense, file?: File) => Promise<void>;
  onDownload: (expense: SchedulerGlobalExpense, attachmentId: string, filename: string) => Promise<void>;
  onDeleteAttachment: (expense: SchedulerGlobalExpense, attachmentId: string, filename: string) => Promise<void>;
  onDelete: (expense: SchedulerGlobalExpense) => Promise<void>;
};

function BillRow(props: BillActions) {
  const { expense } = props;
  return (
    <tr className="border-b border-[var(--border)]/70 align-top last:border-0">
      <td className="px-4 py-3"><strong className="block text-[var(--text)]">{expense.job.jobName}</strong><span className="mt-0.5 block text-xs text-[var(--text-sub)]">{financeAppLabel(expense.source.sourceApp)}</span></td>
      <td className="px-3 py-3"><strong className="block text-[var(--text)]">{expense.description}</strong><span className="mt-0.5 block text-xs capitalize text-[var(--text-sub)]">{expense.kind.replace('_', ' ')} · {expense.category}</span></td>
      <td className="px-3 py-3 text-[var(--text-sub)]">{expense.vendor || '—'}{expense.reference ? <span className="block text-xs">{expense.reference}</span> : null}</td>
      <td className="px-3 py-3 text-[var(--text-sub)]">{dateLabel(expense.incurredAt)}</td>
      <td className="px-3 py-3 text-right font-bold text-[var(--text)]">{money(expense.costAmount, expense.currency)}</td>
      <td className="px-3 py-3 text-right font-bold text-[var(--text)]">{expense.billable ? money(expense.effectiveBillableAmount, expense.currency) : 'Non-billable'}</td>
      <td className="px-3 py-3"><AttachmentList {...props} /></td>
      <td className="px-4 py-3"><CostActions {...props} /></td>
    </tr>
  );
}

function BillCard(props: BillActions) {
  const { expense } = props;
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-extrabold text-[var(--text)]">{expense.description}</h3><p className="mt-1 text-xs text-[var(--text-sub)]">{expense.job.jobName} · {financeAppLabel(expense.source.sourceApp)}</p></div><CostState expense={expense} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-[var(--text-sub)]">Vendor</dt><dd className="truncate font-semibold">{expense.vendor || '—'}</dd></div><div><dt className="text-xs text-[var(--text-sub)]">Date</dt><dd className="font-semibold">{dateLabel(expense.incurredAt)}</dd></div><div><dt className="text-xs text-[var(--text-sub)]">Cost</dt><dd className="font-extrabold">{money(expense.costAmount, expense.currency)}</dd></div><div><dt className="text-xs text-[var(--text-sub)]">Billable</dt><dd className="font-extrabold">{expense.billable ? money(expense.effectiveBillableAmount, expense.currency) : 'No'}</dd></div></dl>
      <div className="mt-3 border-t border-[var(--border)] pt-3"><AttachmentList {...props} /><CostActions {...props} mobile /></div>
    </article>
  );
}

function CostState({ expense }: { expense: SchedulerGlobalExpense }) {
  const label = expense.invoiced ? 'Invoiced' : expense.reserved ? 'In draft' : 'Available';
  const className = expense.invoiced ? 'bg-[var(--green-soft)] text-[var(--green)]' : expense.reserved ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'bg-[var(--surface2)] text-[var(--text-sub)]';
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${className}`}>{label}</span>;
}

function AttachmentList(props: BillActions) {
  const { expense, busy, onUpload, onDownload, onDeleteAttachment } = props;
  const attachments = expense.attachments ?? [];
  // A draft reservation freezes the customer charge, not its private evidence.
  const locked = expense.invoiced;
  return (
    <div className="min-w-[10rem] space-y-2">
      <CostState expense={expense} />
      {attachments.map((attachment) => (
        <div key={attachment.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 py-1.5 text-xs">
          <span className="block max-w-48 truncate font-semibold text-[var(--text)]" title={attachment.filename}>{attachment.filename}</span>
          <div className="mt-1 flex flex-wrap gap-1"><button type="button" aria-label={`Download ${attachment.filename}`} className="min-h-11 px-2 font-bold text-[var(--primary)] hover:underline" disabled={busy} onClick={() => void onDownload(expense, attachment.id, attachment.filename)}>Download</button><button type="button" aria-label={`Delete ${attachment.filename}`} className="min-h-11 px-2 font-bold text-[var(--red)] hover:underline disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || locked} onClick={() => void onDeleteAttachment(expense, attachment.id, attachment.filename)}>Delete</button></div>
        </div>
      ))}
      <label className={buttonClassName('ghost', `w-full !px-2 focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] ${locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`)}>
        {busy ? 'Uploading…' : attachments.length ? 'Add attachment' : 'Attach bill'}
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" disabled={busy || locked} onChange={(event) => { void onUpload(expense, event.target.files?.[0]); event.currentTarget.value = ''; }} />
      </label>
      {locked ? <p className="text-[10px] leading-4 text-[var(--text-sub)]">Evidence is read-only after invoice issue.</p> : null}
    </div>
  );
}

function CostActions({ expense, busy, onEdit, onDelete, mobile = false }: BillActions & { mobile?: boolean }) {
  const locked = expense.invoiced || expense.reserved;
  return (
    <div className={`${mobile ? 'mt-3' : ''} flex flex-wrap justify-end gap-1`}>
      <Button type="button" variant="ghost" disabled={busy || locked} onClick={() => onEdit(expense)}>Edit</Button>
      <Button type="button" variant="ghost" disabled={busy || locked} className="text-[var(--red)]" onClick={() => void onDelete(expense)}>Delete cost</Button>
      {locked ? <span className="w-full text-right text-[10px] leading-4 text-[var(--text-sub)]">Invoice-linked costs cannot be changed.</span> : null}
    </div>
  );
}
