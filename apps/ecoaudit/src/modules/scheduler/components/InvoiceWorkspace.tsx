'use client';

import { useMemo, useRef, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { InvoiceRefundsPanel } from '@/modules/scheduler/components/InvoiceRefundsPanel';
import { Checkbox, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import {
  downloadSchedulerInvoicePdfExport,
  getLatestSchedulerInvoicePdfExport,
  getSchedulerInvoicePdfExportStatus,
  startSchedulerInvoicePdfExport,
} from '@/modules/scheduler/api/client';
import {
  useCompleteSchedulerJob,
  useCreateQuickSchedulerInvoice,
  useIssueSchedulerInvoice,
  useMarkSchedulerInvoicePaid,
  useSchedulerInvoice,
  useSchedulerInvoiceEmailDeliveries,
  useSchedulerInvoices,
  useSendSchedulerInvoiceEmail,
  useUpdateSchedulerInvoice,
  useUpdateSchedulerInvoiceSeller,
  useVoidSchedulerInvoice,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  availableInvoiceExpenses,
  consolidatedInvoiceRecipientIssue,
  financeAppLabel,
  invoiceDraftIsDirty,
  invoiceEmailAttemptNeedsSameIdempotencyKey,
  invoiceQuantityRateForAmount,
  invoiceStatusLabel,
  normalizeInvoiceEmailRecipientList,
  schedulerInvoicePdfFallbackFilename,
  schedulerInvoicePdfReportVariantKey,
} from '@/modules/scheduler/lib/finance';
import type {
  FinanceSourceApp,
  FinanceSourceType,
  SchedulerFinancialSummary,
  SchedulerInvoice,
  SchedulerInvoiceLine,
  SchedulerInvoiceLineKind,
  SchedulerInvoiceListItem,
  UpdateSchedulerInvoiceInput,
} from '@/modules/scheduler/types/domain';

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function displayDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateInput(value: string | null): string {
  return value?.slice(0, 10) ?? '';
}

function newInvoiceEmailIdempotencyKey(invoiceId: string): string {
  const nonce = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `scheduler-invoice-email:${invoiceId}:${nonce}`;
}

type PendingInvoiceEmailRequest = {
  idempotencyKey: string;
  sourceUpdatedAt: string;
  recipient: string;
  subject: string;
  message: string;
};

function invoiceEmailSessionKey(invoiceId: string): string {
  return `scheduler-invoice-email:${encodeURIComponent(invoiceId)}`;
}

function readPendingInvoiceEmail(key: string): PendingInvoiceEmailRequest | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) ?? 'null') as Partial<PendingInvoiceEmailRequest> | null;
    return parsed
      && typeof parsed.idempotencyKey === 'string'
      && typeof parsed.sourceUpdatedAt === 'string'
      && typeof parsed.recipient === 'string'
      && typeof parsed.subject === 'string'
      && typeof parsed.message === 'string'
      ? parsed as PendingInvoiceEmailRequest
      : null;
  } catch {
    return null;
  }
}

function writePendingInvoiceEmail(key: string, request: PendingInvoiceEmailRequest): boolean {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}

function clearPendingInvoiceEmail(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // A definitive server response still makes the request safe; storage may
    // be unavailable in privacy-restricted browser contexts.
  }
}

const statusClasses = {
  draft: 'bg-[var(--surface2)] text-[var(--text-sub)]',
  issued: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  paid: 'bg-[var(--green-soft)] text-[var(--green)]',
  void: 'bg-[var(--red-soft)] text-[var(--red)]',
};

function StatusBadge({ invoice }: { invoice: Pick<SchedulerInvoiceListItem, 'status' | 'overdue'> }) {
  if (invoice.overdue && invoice.status === 'issued') {
    return <span className="rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-xs font-extrabold text-[var(--red)]">Overdue</span>;
  }
  return <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${statusClasses[invoice.status]}`}>{invoiceStatusLabel(invoice.status)}</span>;
}

type InvoiceDraftSaveInput = Omit<UpdateSchedulerInvoiceInput, 'expectedUpdatedAt'>;

type EditableInvoiceLine = {
  clientKey: string;
  id?: string;
  description: string;
  quantity: string;
  unitAmountExGst: string;
  amountExGst: string;
  showQuantityAndRate: boolean;
  expenseId: string | null;
  kind: SchedulerInvoiceLineKind;
  financeId: string;
};

let editableLineSequence = 0;

function isCompletedJobStatus(status: string): boolean {
  return status.trim().toLocaleLowerCase('en-AU') === 'completed';
}

export type InvoiceCompletableJob = {
  financeId: string;
  sourceApp: FinanceSourceApp;
  sourceType: FinanceSourceType;
  sourceId: string;
  jobName: string;
};

export function InvoiceJobCompletionAction({
  job,
  onCompleted,
  className = '',
}: {
  job: InvoiceCompletableJob;
  onCompleted?: () => void | Promise<void>;
  className?: string;
}) {
  const complete = useCompleteSchedulerJob();
  const toast = useToast();
  const completionIdempotencyKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markComplete() {
    if (!window.confirm(
      `Mark ${job.jobName} complete? This closes the Field App job and linked Scheduler work.`,
    )) return;
    setError(null);
    const idempotencyKey = completionIdempotencyKeyRef.current ?? crypto.randomUUID();
    completionIdempotencyKeyRef.current = idempotencyKey;
    try {
      await complete.mutateAsync({
        sourceApp: job.sourceApp,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        idempotencyKey,
      });
      completionIdempotencyKeyRef.current = null;
      toast.success(`${job.jobName} and its linked Scheduler work are complete.`);
      try {
        await onCompleted?.();
      } catch {
        // The completion mutation invalidates every Scheduler query. A local
        // refresh is best-effort and must not misreport a completed job as failed.
      }
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        disabled={complete.isPending}
        aria-busy={complete.isPending}
        onClick={() => void markComplete()}
      >
        {complete.isPending ? 'Completing…' : 'Mark job complete'}
      </Button>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
    </div>
  );
}

function numericInputValue(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

function editableInvoiceLine(line: SchedulerInvoiceLine): EditableInvoiceLine {
  return {
    clientKey: line.id,
    id: line.id,
    description: line.description,
    quantity: numericInputValue(line.quantity),
    unitAmountExGst: numericInputValue(line.unitAmountExGst),
    amountExGst: numericInputValue(line.lineTotalExGst),
    showQuantityAndRate: line.showQuantityAndRate,
    expenseId: line.expenseId,
    kind: line.kind,
    financeId: line.financeId,
  };
}

function newEditableInvoiceLine(financeId: string): EditableInvoiceLine {
  editableLineSequence += 1;
  return {
    clientKey: `new-line-${editableLineSequence}`,
    description: '',
    quantity: '1',
    unitAmountExGst: '',
    amountExGst: '',
    showQuantityAndRate: false,
    expenseId: null,
    kind: 'other',
    financeId,
  };
}

function editableLineTotal(line: EditableInvoiceLine): number {
  if (!line.showQuantityAndRate) {
    return line.amountExGst.trim() ? Number(line.amountExGst) : Number.NaN;
  }
  if (!line.quantity.trim() || !line.unitAmountExGst.trim()) return Number.NaN;
  return Number(line.quantity) * Number(line.unitAmountExGst);
}

function editableLinePayload(line: EditableInvoiceLine): NonNullable<UpdateSchedulerInvoiceInput['lines']>[number] {
  const quantity = line.showQuantityAndRate ? Number(line.quantity) : 1;
  const unitAmountExGst = line.showQuantityAndRate
    ? Number(line.unitAmountExGst)
    : Number(line.amountExGst);
  return {
    ...(line.id ? { id: line.id } : {}),
    description: line.description.trim(),
    quantity,
    unitAmountExGst,
    showQuantityAndRate: line.showQuantityAndRate,
    expenseId: line.expenseId,
    kind: line.kind,
    financeId: line.financeId,
  };
}

function invoiceLinesAreDirty(
  original: SchedulerInvoiceLine[],
  editableLines: EditableInvoiceLine[],
): boolean {
  const originalPayload = original.map((line) => editableLinePayload(editableInvoiceLine(line)));
  const nextPayload = editableLines.map(editableLinePayload);
  return JSON.stringify(originalPayload) !== JSON.stringify(nextPayload);
}

export function InvoiceWorkspace({
  financeId,
  summary,
  selectedInvoiceId,
  onSelectInvoice,
}: {
  financeId: string;
  summary: SchedulerFinancialSummary;
  selectedInvoiceId: string | null;
  onSelectInvoice: (invoiceId: string | null) => void;
}) {
  const invoices = useSchedulerInvoices(financeId);
  const create = useCreateQuickSchedulerInvoice(financeId);
  const toast = useToast();
  const availableExpenses = useMemo(
    () => availableInvoiceExpenses(summary.expenses),
    [summary.expenses],
  );
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [includeLabour, setIncludeLabour] = useState(
    summary.pricing.mode === 'quoted' || summary.time.labourRevenue > 0,
  );
  const [draftNotes, setDraftNotes] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobCompleted = isCompletedJobStatus(summary.job.status);
  const missingBillingRateUsers = summary.time.missingBillingRateUsers;

  async function createDraft() {
    if (!jobCompleted) {
      setError(`Complete ${summary.job.jobName} before creating an invoice.`);
      return;
    }
    setError(null);
    try {
      const invoice = await create.mutateAsync({
        expenseIds: selectedExpenseIds,
        includeLabour,
        notes: draftNotes.trim() || null,
      });
      setQuickOpen(false);
      setDraftNotes('');
      onSelectInvoice(invoice.id);
      toast.success(`Draft ${invoice.invoiceNumber} created.`);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  const list = invoices.data ?? summary.invoices;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="invoice-workspace-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="invoice-workspace-heading" className="font-extrabold text-[var(--text)]">Invoices</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Draft, issue, revise, download, and retain every generated PDF version.</p>
        </div>
        <Button type="button" disabled={!jobCompleted} title={!jobCompleted ? 'Complete this job before creating an invoice' : undefined} onClick={() => {
          if (!quickOpen) setSelectedExpenseIds(availableExpenses.map((expense) => expense.id));
          setQuickOpen(!quickOpen);
        }}>
          {quickOpen ? 'Close draft setup' : '+ New invoice'}
        </Button>
      </div>

      {!jobCompleted ? (
        <div className="mt-4 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-3 py-2.5 text-sm font-semibold leading-6 text-[var(--amber)]">
          <p role="status">Complete this job before creating an invoice or preparing its PDF.</p>
          {summary.source.sourceApp === 'installhub' && summary.source.sourceType === 'installation' ? (
            <InvoiceJobCompletionAction
              className="mt-2"
              job={{
                financeId,
                sourceApp: summary.source.sourceApp,
                sourceType: summary.source.sourceType,
                sourceId: summary.source.sourceId,
                jobName: summary.job.jobName,
              }}
            />
          ) : null}
        </div>
      ) : null}
      {summary.pricing.mode === 'charge_up' && missingBillingRateUsers.length > 0 ? (
        <p className="mt-4 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-3 py-2.5 text-sm font-semibold leading-6 text-[var(--amber)]" role="status">
          Ask an admin to add a billing rate for {missingBillingRateUsers.map((user) => user.displayName ?? user.userId).join(', ')} before adding a labour suggestion.
        </p>
      ) : null}

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

      {quickOpen ? (
        <div className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface2)] p-4">
          <h3 className="font-extrabold text-[var(--text)]">Create invoice draft</h3>
          <p className="mt-1 text-sm text-[var(--text-sub)]">
            {summary.pricing.mode === 'quoted'
              ? 'Include the remaining quote balance and any selected billable expenses.'
              : 'Start with an optional labour suggestion and selected billable expenses.'}
          </p>
          <Checkbox
            label={summary.pricing.mode === 'quoted' ? 'Include remaining quote balance' : 'Add suggested labour charge'}
            checked={includeLabour}
            disabled={summary.pricing.mode === 'charge_up' && summary.time.labourRevenue <= 0}
            onChange={setIncludeLabour}
          />
          {summary.pricing.mode === 'charge_up' ? (
            <FieldHint>The labour charge is only a suggestion. You can edit or remove it in the draft; internal hours and rates stay off the invoice unless you explicitly show them.</FieldHint>
          ) : null}

          <fieldset className="mt-3">
            <legend className="text-sm font-extrabold text-[var(--text)]">Uninvoiced billable costs</legend>
            {availableExpenses.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--text-sub)]">No billable expenses are available.</p>
            ) : (
              <div className="mt-1 grid gap-x-4 md:grid-cols-2">
                {availableExpenses.map((expense) => (
                  <Checkbox
                    key={expense.id}
                    label={`${expense.description} · ${money(expense.effectiveBillableAmount, summary.currency)}${expense.billableAmount == null ? ' (at cost)' : ''}`}
                    checked={selectedExpenseIds.includes(expense.id)}
                    onChange={(checked) => setSelectedExpenseIds((current) => (
                      checked ? [...current, expense.id] : current.filter((id) => id !== expense.id)
                    ))}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <FieldLabel htmlFor="quick-invoice-notes">Invoice notes</FieldLabel>
          <Textarea id="quick-invoice-notes" rows={3} value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={create.isPending} onClick={() => setQuickOpen(false)}>Cancel</Button>
            <Button type="button" disabled={create.isPending || !jobCompleted} onClick={() => void createDraft()}>
              {create.isPending ? 'Creating…' : 'Create draft'}
            </Button>
          </div>
        </div>
      ) : null}

      {invoices.isLoading ? <Spinner label="Loading invoices…" /> : invoices.error ? (
        <div className="mt-4"><ErrorBanner message={cloudConnectionErrorMessage(invoices.error)} /></div>
      ) : list.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-sub)]">No invoices yet.</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav className="space-y-2" aria-label="Job invoices">
            {list.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                aria-current={selectedInvoiceId === invoice.id ? 'true' : undefined}
                onClick={() => onSelectInvoice(invoice.id)}
                className={`min-h-11 w-full rounded-xl border p-3 text-left transition-colors ${selectedInvoiceId === invoice.id ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] hover:bg-[var(--surface2)]'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-[var(--text)]">{invoice.invoiceNumber}</span>
                  <StatusBadge invoice={invoice} />
                </span>
                <span className="mt-2 flex justify-between gap-2 text-xs text-[var(--text-sub)]">
                  <span>Due {displayDate(invoice.dueDate)}</span>
                  <span className="font-extrabold text-[var(--text)]">{money(invoice.totalIncGst, invoice.currency)}</span>
                </span>
              </button>
            ))}
          </nav>
          {selectedInvoiceId ? (
            <InvoiceDetail
              key={selectedInvoiceId}
              financeId={financeId}
              invoiceId={selectedInvoiceId}
              currentJobStatus={summary.job.status}
              onClose={() => onSelectInvoice(null)}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-sub)]">Select an invoice to review or edit it.</div>
          )}
        </div>
      )}
    </section>
  );
}

function InvoiceDetail({
  financeId,
  invoiceId,
  currentJobStatus,
  onClose,
}: {
  financeId: string;
  invoiceId: string;
  currentJobStatus: string;
  onClose: () => void;
}) {
  const query = useSchedulerInvoice(financeId, invoiceId);
  const update = useUpdateSchedulerInvoice(financeId);
  const issue = useIssueSchedulerInvoice(financeId);
  const markPaid = useMarkSchedulerInvoicePaid(financeId);
  const voidInvoice = useVoidSchedulerInvoice(financeId);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) return <Spinner label="Loading invoice detail…" />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Invoice not found." />;

  return (
    <InvoiceDocument
      key={`${query.data.id}:${query.data.updatedAt}`}
      financeId={financeId}
      invoice={query.data}
      currentJobStatuses={{ [financeId]: currentJobStatus }}
      busy={update.isPending || issue.isPending || markPaid.isPending || voidInvoice.isPending}
      error={error}
      onClose={onClose}
      onRefresh={async () => { await query.refetch(); }}
      onSave={async (input, expectedUpdatedAt) => {
        setError(null);
        try {
          await update.mutateAsync({
            invoiceId,
            input: { ...input, expectedUpdatedAt },
          });
          toast.success('Invoice saved.');
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
      onIssue={async (expectedUpdatedAt) => {
        setError(null);
        try {
          const issued = await issue.mutateAsync({
            invoiceId,
            expectedUpdatedAt,
          });
          toast.success(issued.pdfExport?.invoiceVersion
            ? `${query.data.invoiceNumber} issued; final PDF v${issued.pdfExport.invoiceVersion} is being stored.`
            : `${query.data.invoiceNumber} issued.`);
          return issued;
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
          throw cause;
        }
      }}
      onMarkPaid={async () => {
        setError(null);
        try {
          await markPaid.mutateAsync({ invoiceId, expectedUpdatedAt: query.data.updatedAt });
          toast.success(`${query.data.invoiceNumber} marked paid.`);
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
      onVoid={async () => {
        if (!window.confirm(`Void ${query.data.invoiceNumber}? Reserved job charges will be released.`)) return;
        setError(null);
        try {
          await voidInvoice.mutateAsync({ invoiceId, expectedUpdatedAt: query.data.updatedAt });
          toast.success(`${query.data.invoiceNumber} voided.`);
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
    />
  );
}

export function InvoiceDocument({
  financeId,
  invoice,
  busy,
  error,
  onClose,
  onRefresh,
  onSave,
  onIssue,
  onMarkPaid,
  onVoid,
  onStartPdf,
  currentJobStatuses,
}: {
  financeId: string;
  invoice: SchedulerInvoice;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSave: (input: InvoiceDraftSaveInput, expectedUpdatedAt: string) => Promise<void>;
  onIssue: (expectedUpdatedAt: string) => Promise<SchedulerInvoice>;
  onMarkPaid: () => Promise<void>;
  onVoid: () => Promise<void>;
  onStartPdf?: (expectedUpdatedAt: string) => ReturnType<typeof startSchedulerInvoicePdfExport>;
  currentJobStatuses?: Readonly<Record<string, string>>;
}) {
  const editable = invoice.status === 'draft' || invoice.status === 'issued';
  const seller = useUpdateSchedulerInvoiceSeller(invoice.id);
  const [sellerAbn, setSellerAbn] = useState(invoice.sellerAbn ?? '');
  const sellerSaveRef = useRef<Promise<SchedulerInvoice> | null>(null);
  const [notes, setNotes] = useState(invoice.notes ?? '');
  const [dueDate, setDueDate] = useState(dateInput(invoice.dueDate));
  const [billToName, setBillToName] = useState(invoice.billToName ?? '');
  const [billToAddress, setBillToAddress] = useState(invoice.billToAddress ?? '');
  const [billToEmail, setBillToEmail] = useState(invoice.billToEmail ?? '');
  const [billToAbn, setBillToAbn] = useState(invoice.billToAbn ?? '');
  const [purchaseOrderReference, setPurchaseOrderReference] = useState(
    invoice.purchaseOrderReference ?? '',
  );
  const [draftLines, setDraftLines] = useState<EditableInvoiceLine[]>(() => (
    invoice.lines.map(editableInvoiceLine)
  ));
  const [validation, setValidation] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const emailSessionKey = useMemo(
    () => invoiceEmailSessionKey(invoice.id),
    [invoice.id],
  );
  const initialEmailRequest = useMemo(() => {
    const pending = readPendingInvoiceEmail(emailSessionKey);
    return {
      idempotencyKey: pending?.idempotencyKey ?? newInvoiceEmailIdempotencyKey(invoice.id),
      sourceUpdatedAt: pending?.sourceUpdatedAt ?? invoice.updatedAt,
      recipient: pending?.recipient ?? invoice.billToEmail ?? '',
      subject: pending?.subject ?? `Invoice ${invoice.invoiceNumber} from ${invoice.sellerName}`,
      message: pending?.message ?? `Hello ${invoice.billToName || 'there'},\n\nPlease find invoice ${invoice.invoiceNumber} attached.\n\nRegards,\n${invoice.sellerName}`,
      locked: Boolean(pending),
    };
  }, [emailSessionKey, invoice.billToEmail, invoice.billToName, invoice.id, invoice.invoiceNumber, invoice.sellerName, invoice.updatedAt]);
  const [emailTo, setEmailTo] = useState(initialEmailRequest.recipient);
  const [emailSubject, setEmailSubject] = useState(initialEmailRequest.subject);
  const [emailMessage, setEmailMessage] = useState(initialEmailRequest.message);
  const [emailIdempotencyKey, setEmailIdempotencyKey] = useState(initialEmailRequest.idempotencyKey);
  const [emailSourceUpdatedAt, setEmailSourceUpdatedAt] = useState(initialEmailRequest.sourceUpdatedAt);
  const [emailRetryLocked, setEmailRetryLocked] = useState(initialEmailRequest.locked);
  const [emailFinalWhenReady, setEmailFinalWhenReady] = useState(false);
  const toast = useToast();
  const sendEmail = useSendSchedulerInvoiceEmail(invoice.id);
  const emailDeliveries = useSchedulerInvoiceEmailDeliveries(invoice.id, true);
  const lineJobOptions = useMemo(() => {
    if (invoice.jobs?.length) {
      return invoice.jobs.map((job) => ({
        financeId: job.financeId,
        sourceApp: job.source.sourceApp,
        sourceType: job.source.sourceType,
        sourceId: job.source.sourceId,
        jobName: job.job.jobName,
        siteName: job.job.siteName,
        status: currentJobStatuses?.[job.financeId] ?? job.currentStatus,
      }));
    }
    return [{
      financeId,
      sourceApp: invoice.job.sourceApp,
      sourceType: invoice.job.sourceType,
      sourceId: invoice.job.sourceId,
      jobName: invoice.job.jobName,
      siteName: invoice.job.siteName,
      status: currentJobStatuses?.[financeId] ?? invoice.job.status,
    }];
  }, [currentJobStatuses, financeId, invoice.job, invoice.jobs]);
  const incompleteJobs = lineJobOptions.filter((job) => !isCompletedJobStatus(job.status));
  const allJobsCompleted = incompleteJobs.length === 0;
  const hasVisibleQuantityAndRate = invoice.lines.some((line) => line.showQuantityAndRate);
  const everyJobHasPositiveDraftCharge = lineJobOptions.every((job) => draftLines
    .filter((line) => line.financeId === job.financeId)
    .reduce((total, line) => {
      const lineTotal = editableLineTotal(line);
      return Number.isFinite(lineTotal) ? total + lineTotal : total;
    }, 0) > 0);
  const pdfArtifactName = invoice.status === 'draft'
    ? 'draft invoice PDF'
    : 'final invoice PDF';
  const reportVariantKey = schedulerInvoicePdfReportVariantKey(invoice);
  const pdfExport = useExportJob({
    scopeKey: ['scheduler', 'invoice-pdf', invoice.id, invoice.updatedAt],
    loadLatest: () => getLatestSchedulerInvoicePdfExport(invoice.id, reportVariantKey),
    getStatus: getSchedulerInvoicePdfExportStatus,
    downloadJob: downloadSchedulerInvoicePdfExport,
    fallbackFilename: schedulerInvoicePdfFallbackFilename(invoice),
    matchesJob: (job) => (
      job.artifactType === 'pdf'
      && job.reportVariantKey === reportVariantKey
    ),
  });
  const invoiceActionBusy = busy
    || seller.isPending
    || pdfExport.starting
    || pdfExport.active
    || pdfExport.downloading
    || sendEmail.isPending;
  const headerDirty = editable && invoiceDraftIsDirty({
    notes: invoice.notes ?? '',
    dueDate: dateInput(invoice.dueDate),
    billToName: invoice.billToName ?? '',
    billToAddress: invoice.billToAddress ?? '',
    billToEmail: invoice.billToEmail ?? '',
    billToAbn: invoice.billToAbn ?? '',
    purchaseOrderReference: invoice.purchaseOrderReference ?? '',
  }, { notes, dueDate, billToName, billToAddress, billToEmail, billToAbn, purchaseOrderReference });
  const linesDirty = editable && invoiceLinesAreDirty(invoice.lines, draftLines);
  const dirty = headerDirty || linesDirty;
  const invoiceLifecycleBusy = invoiceActionBusy || emailRetryLocked;
  const liveSubtotalExGst = editable
    ? draftLines.reduce((total, line) => {
      const lineTotal = editableLineTotal(line);
      return Number.isFinite(lineTotal) ? total + lineTotal : total;
    }, 0)
    : invoice.subtotalExGst;
  const liveGstAmount = editable
    ? Math.round(liveSubtotalExGst * invoice.gstRate * 100) / 100
    : invoice.gstAmount;
  const liveTotalIncGst = editable
    ? liveSubtotalExGst + liveGstAmount
    : invoice.totalIncGst;

  async function saveSellerAbnIfNeeded(): Promise<string> {
    if (sellerSaveRef.current) return (await sellerSaveRef.current).updatedAt;
    const next = sellerAbn.trim() ? sellerAbn.replace(/\D/g, '') : null;
    if (next === (invoice.sellerAbn ?? null)) return invoice.updatedAt;
    const pending = seller.mutateAsync({
      sellerAbn: next,
      expectedUpdatedAt: invoice.updatedAt,
    });
    sellerSaveRef.current = pending;
    try {
      const updated = await pending;
      setSellerAbn(updated.sellerAbn ?? '');
      return updated.updatedAt;
    } finally {
      sellerSaveRef.current = null;
    }
  }

  async function saveDraft() {
    if (!billToName.trim()) {
      setValidation('Billing name is required before this draft can be saved or issued.');
      return;
    }
    for (let index = 0; index < draftLines.length; index += 1) {
      const line = draftLines[index]!;
      if (!line.description.trim()) {
        setValidation(`Charge ${index + 1} needs a description.`);
        return;
      }
      if (!lineJobOptions.some((job) => job.financeId === line.financeId)) {
        setValidation(`Charge ${index + 1} is not assigned to an invoice job.`);
        return;
      }
      const quantity = Number(line.quantity);
      const rate = Number(line.unitAmountExGst);
      const amount = editableLineTotal(line);
      if (
        !Number.isFinite(amount)
        || amount < 0
        || (line.showQuantityAndRate && (!Number.isFinite(quantity) || quantity <= 0))
        || (line.showQuantityAndRate && (!Number.isFinite(rate) || rate < 0))
      ) {
        setValidation(`Charge ${index + 1} needs a nonnegative amount${line.showQuantityAndRate ? ', positive quantity, and valid rate' : ''}.`);
        return;
      }
    }
    setValidation(null);
    const expectedUpdatedAt = await saveSellerAbnIfNeeded();
    await onSave({
      notes: notes.trim() || null,
      dueDate: dueDate || null,
      billToName: billToName.trim(),
      billToAddress: billToAddress.trim() || null,
      billToEmail: billToEmail.trim() || null,
      billToAbn: billToAbn.trim() || null,
      purchaseOrderReference: purchaseOrderReference.trim() || null,
      lines: draftLines.map(editableLinePayload),
    }, expectedUpdatedAt);
  }

  async function preparePdf() {
    if (editable && !allJobsCompleted) {
      setValidation(`Complete ${incompleteJobs.map((job) => job.jobName).join(', ')} before preparing the invoice PDF.`);
      return;
    }
    try {
      const expectedUpdatedAt = await saveSellerAbnIfNeeded();
      await pdfExport.start(() => onStartPdf
        ? onStartPdf(expectedUpdatedAt)
        : startSchedulerInvoicePdfExport(financeId, invoice.id, expectedUpdatedAt));
      toast.success(`${pdfArtifactName[0]!.toUpperCase()}${pdfArtifactName.slice(1)} preparation started. You can leave this page while it finishes.`);
    } catch (cause) {
      await onRefresh().catch(() => {});
      toast.error(cloudConnectionErrorMessage(cause));
    }
  }

  async function downloadPdf() {
    try {
      await pdfExport.download();
      toast.success(`${pdfArtifactName[0]!.toUpperCase()}${pdfArtifactName.slice(1)} download started.`);
    } catch (cause) {
      toast.error(cloudConnectionErrorMessage(cause));
    }
  }

  async function issueInvoice() {
    if (!allJobsCompleted) {
      setValidation(`Complete ${incompleteJobs.map((job) => job.jobName).join(', ')} before issuing this invoice.`);
      return;
    }
    if (!everyJobHasPositiveDraftCharge) {
      setValidation('Add at least one positive charge for every included job before issuing. You can still save an empty or zero-value draft.');
      return;
    }
    const recipientIssue = consolidatedInvoiceRecipientIssue({
      name: invoice.billToName,
    });
    if (recipientIssue) {
      setValidation(recipientIssue);
      return;
    }
    if (invoice.gstRate > 0 && !sellerAbn.trim()) {
      setValidation('Enter the seller ABN before issuing an invoice with GST.');
      return;
    }
    const emailContent = emailFinalWhenReady ? validatedEmailContent() : null;
    if (emailFinalWhenReady && !emailContent) return;
    setValidation(null);
    try {
      const expectedUpdatedAt = await saveSellerAbnIfNeeded();
      const issued = await onIssue(expectedUpdatedAt);
      if (emailContent) {
        setEmailSourceUpdatedAt(issued.updatedAt);
        setEmailOpen(true);
        const queued = await queueInvoiceEmail(issued.updatedAt, emailContent);
        if (queued) {
          toast.success('Final invoice PDF and client email queued. Delivery status will update here.');
        } else {
          toast.error('The invoice was issued, but its email was not queued. Review the email section and retry.');
        }
      }
    } catch (cause) {
      setValidation(cloudConnectionErrorMessage(cause));
    }
  }

  function validatedEmailContent(): {
    recipient: string;
    subject: string;
    message: string;
  } | null {
    const recipient = normalizeInvoiceEmailRecipientList(emailTo);
    if (!recipient) {
      setValidation('Enter between 1 and 10 valid recipient email addresses, separated by commas.');
      return null;
    }
    if (!emailSubject.trim()) {
      setValidation('Add an email subject.');
      return null;
    }
    if (!emailMessage.trim()) {
      setValidation('Add a short email message.');
      return null;
    }
    return {
      recipient,
      subject: emailSubject.trim(),
      message: emailMessage.trim(),
    };
  }

  async function queueInvoiceEmail(
    sourceUpdatedAt: string,
    content: NonNullable<ReturnType<typeof validatedEmailContent>>,
  ): Promise<boolean> {
    const request = {
      idempotencyKey: emailIdempotencyKey,
      sourceUpdatedAt,
      ...content,
    };
    if (!writePendingInvoiceEmail(emailSessionKey, request)) {
      setValidation('This browser could not safely retain the email request for retry. Enable session storage and try again.');
      return false;
    }
    setEmailRetryLocked(true);
    setValidation(null);
    try {
      const response = await sendEmail.mutateAsync({
        expectedUpdatedAt: request.sourceUpdatedAt,
        idempotencyKey: request.idempotencyKey,
        to: request.recipient,
        subject: request.subject,
        message: request.message,
      });
      toast.success(response.reused
        ? 'The existing invoice email request is still being tracked.'
        : 'Invoice email queued. Delivery status will update here.');
      clearPendingInvoiceEmail(emailSessionKey);
      setEmailRetryLocked(false);
      setEmailIdempotencyKey(newInvoiceEmailIdempotencyKey(invoice.id));
      setEmailSourceUpdatedAt(sourceUpdatedAt);
      setEmailOpen(false);
      return true;
    } catch (cause) {
      if (!invoiceEmailAttemptNeedsSameIdempotencyKey(cause)) {
        clearPendingInvoiceEmail(emailSessionKey);
        setEmailRetryLocked(false);
        setEmailIdempotencyKey(newInvoiceEmailIdempotencyKey(invoice.id));
        setEmailSourceUpdatedAt(sourceUpdatedAt);
      }
      setValidation(cloudConnectionErrorMessage(cause));
      return false;
    }
  }

  async function emailInvoice() {
    const content = validatedEmailContent();
    if (!content) return;
    await queueInvoiceEmail(emailSourceUpdatedAt, content);
  }

  function updateDraftLine(clientKey: string, change: Partial<EditableInvoiceLine>) {
    setDraftLines((current) => current.map((line) => (
      line.clientKey === clientKey ? { ...line, ...change } : line
    )));
  }

  function setLineQuantityVisibility(line: EditableInvoiceLine, showQuantityAndRate: boolean) {
    if (showQuantityAndRate) {
      const quantityRate = invoiceQuantityRateForAmount(line);
      updateDraftLine(line.clientKey, {
        showQuantityAndRate: true,
        ...quantityRate,
      });
      return;
    }
    const total = editableLineTotal(line);
    updateDraftLine(line.clientKey, {
      showQuantityAndRate: false,
      amountExGst: Number.isFinite(total) ? numericInputValue(total) : '',
    });
  }

  return (
    <article className="min-w-0 rounded-xl border border-[var(--border)] p-4" aria-labelledby={`invoice-${invoice.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`invoice-${invoice.id}`} className="text-lg font-extrabold text-[var(--text)]">{invoice.invoiceNumber}</h3>
            <StatusBadge invoice={invoice} />
          </div>
          <p className="mt-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]">Internal invoice number</p>
          {lineJobOptions.length === 1 ? (
            <div className="mt-1">
              <p className="text-base font-extrabold leading-6 text-[var(--text)]">{lineJobOptions[0]!.jobName}</p>
              <p className="text-xs leading-5 text-[var(--text-sub)]">{lineJobOptions[0]!.siteName || 'Site not set'} · {displayDate(invoice.job.jobDate)}</p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-sub)]">{invoice.jobCount} jobs · {(invoice.jobNames ?? []).join(', ')}</p>
          )}
        </div>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
      </div>

      {invoice.status === 'issued' ? (
        <div className="mt-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-3 py-2.5 text-sm text-[var(--text)]">
          This issued invoice can be revised and reissued. Every generated final PDF is retained as the next version.
        </div>
      ) : null}

      {!allJobsCompleted ? (
        <div className="mt-3 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-3 py-2.5 text-sm font-semibold leading-6 text-[var(--amber)]">
          <p role="status">
            {editable
              ? `Complete ${incompleteJobs.map((job) => job.jobName).join(', ')} before issuing this invoice or preparing its PDF.`
              : `This invoice includes incomplete work: ${incompleteJobs.map((job) => job.jobName).join(', ')}.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {incompleteJobs.map((job) => (
              job.sourceApp === 'installhub' && job.sourceType === 'installation' ? (
                <InvoiceJobCompletionAction
                  key={job.financeId}
                  job={job}
                  onCompleted={onRefresh}
                />
              ) : null
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoBlock label="Seller">
          <strong>{invoice.sellerName}</strong>
          {editable ? (
            <>
              <FieldLabel htmlFor={`invoice-seller-abn-${invoice.id}`}>Seller ABN</FieldLabel>
              <Input
                id={`invoice-seller-abn-${invoice.id}`}
                inputMode="numeric"
                value={sellerAbn}
                placeholder="11 digit ABN"
                disabled={seller.isPending}
                onChange={(event) => setSellerAbn(event.target.value)}
                onBlur={() => {
                  void saveSellerAbnIfNeeded().catch((cause) => {
                    setValidation(cloudConnectionErrorMessage(cause));
                  });
                }}
              />
              <FieldHint>{seller.isPending ? 'Saving seller ABN…' : 'Saved immediately for this and future invoices.'}</FieldHint>
            </>
          ) : invoice.sellerAbn ? <span>ABN: {invoice.sellerAbn}</span> : <span>No seller ABN</span>}
        </InfoBlock>
        <InfoBlock label="Bill to">
          <strong>{(editable ? billToName : invoice.billToName) || invoice.job.clientName || 'Billing name not set'}</strong>
          <span>{(editable ? billToEmail : invoice.billToEmail) || 'No email'}</span>
          {(editable ? billToAbn : invoice.billToAbn) ? <span>ABN: {editable ? billToAbn : invoice.billToAbn}</span> : null}
          <span className="whitespace-pre-line">{(editable ? billToAddress : invoice.billToAddress) || invoice.job.siteAddress || 'No billing address'}</span>
          {(editable ? purchaseOrderReference : invoice.purchaseOrderReference)
            ? <span>Customer reference: {editable ? purchaseOrderReference : invoice.purchaseOrderReference}</span>
            : null}
        </InfoBlock>
        <InfoBlock label="Internal dates">
          <span>Internal issue date: {displayDate(invoice.issueDate)}</span>
          <span>Due: {displayDate(editable ? dueDate : invoice.dueDate)}</span>
          {invoice.paidAt ? <span>Paid: {displayDate(invoice.paidAt)}</span> : null}
        </InfoBlock>
        <InfoBlock label="Total">
          <span>Subtotal: {money(liveSubtotalExGst, invoice.currency)}</span>
          <span>GST: {money(liveGstAmount, invoice.currency)}</span>
          <strong>{money(liveTotalIncGst, invoice.currency)} inc GST</strong>
        </InfoBlock>
      </div>

      {invoice.jobs && invoice.jobs.length > 1 ? (
        <section className="mt-4" aria-labelledby={`invoice-jobs-${invoice.id}`}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h4 id={`invoice-jobs-${invoice.id}`} className="font-extrabold text-[var(--text)]">Included jobs</h4>
              <p className="mt-1 text-xs text-[var(--text-sub)]">Each line remains attributed to its source job for revenue and cost reporting.</p>
            </div>
            <span className="text-xs font-bold text-[var(--text-sub)]">{invoice.jobs.length} jobs</span>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {invoice.jobs.map((job) => (
              <article key={job.financeId} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h5 className="truncate text-base font-extrabold leading-6 text-[var(--text)]">{job.job.jobName}</h5>
                    <p className="truncate text-xs leading-5 text-[var(--text-sub)]">{job.job.siteName || 'Site not set'}</p>
                    <p className="text-xs text-[var(--text-sub)]">{financeAppLabel(job.source.sourceApp)} · {displayDate(job.job.jobDate)}</p>
                  </div>
                  <strong className="shrink-0 text-sm text-[var(--text)]">{money(job.subtotalExGst, invoice.currency)}</strong>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-[var(--text-sub)]">
                  {job.lines.map((line) => <li key={line.id} className="flex justify-between gap-3"><span className="truncate">{line.description}</span><span className="shrink-0">{money(line.lineTotalExGst, invoice.currency)}</span></li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {editable ? (
        <>
          <div className="mt-4 grid gap-x-3 md:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`invoice-bill-name-${invoice.id}`}>Bill-to name</FieldLabel>
              <Input id={`invoice-bill-name-${invoice.id}`} value={billToName} onChange={(event) => setBillToName(event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor={`invoice-bill-email-${invoice.id}`}>Bill-to email</FieldLabel>
              <Input id={`invoice-bill-email-${invoice.id}`} type="email" value={billToEmail} onChange={(event) => setBillToEmail(event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor={`invoice-bill-abn-${invoice.id}`}>Recipient ABN</FieldLabel>
              <Input id={`invoice-bill-abn-${invoice.id}`} value={billToAbn} inputMode="numeric" onChange={(event) => setBillToAbn(event.target.value)} />
              <FieldHint>Optional. Use the recipient’s ABN when it helps identify the billed entity.</FieldHint>
            </div>
            <div className="md:col-span-2">
              <FieldLabel htmlFor={`invoice-bill-address-${invoice.id}`}>Bill-to address</FieldLabel>
              <Textarea id={`invoice-bill-address-${invoice.id}`} rows={3} value={billToAddress} onChange={(event) => setBillToAddress(event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor={`invoice-reference-${invoice.id}`}>Customer reference</FieldLabel>
              <Input id={`invoice-reference-${invoice.id}`} value={purchaseOrderReference} onChange={(event) => setPurchaseOrderReference(event.target.value)} />
              <FieldHint>Optional. Enter a purchase order or another reference supplied by the customer.</FieldHint>
            </div>
            <div>
            <FieldLabel htmlFor={`invoice-due-${invoice.id}`}>Due date</FieldLabel>
            <Input id={`invoice-due-${invoice.id}`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="max-w-xs" />
              <FieldHint>If blank, the default due date is applied when this draft is issued.</FieldHint>
            </div>
          </div>
        </>
      ) : null}

      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4" aria-labelledby={`invoice-charges-${invoice.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 id={`invoice-charges-${invoice.id}`} className="font-extrabold text-[var(--text)]">Invoice charges</h4>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-sub)]">
              {editable
                ? 'Edit the customer-facing description and amount. Quantity and rate stay hidden unless you choose to show them.'
                : 'Paid or void invoice charges are retained as historical accounting data.'}
            </p>
          </div>
          {editable ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDraftLines((current) => [
                ...current,
                newEditableInvoiceLine(lineJobOptions[0]?.financeId ?? financeId),
              ])}
            >
              Add charge
            </Button>
          ) : null}
        </div>

        {editable ? (
          draftLines.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center">
              <p className="text-sm font-bold text-[var(--text)]">No invoice charges</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Add a customer-facing charge now, or save the empty draft and return later.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {draftLines.map((line, index) => {
                const total = editableLineTotal(line);
                const prefix = `invoice-line-${index}`;
                return (
                  <article key={line.clientKey} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-[var(--text)]">Charge {index + 1}</strong>
                          {line.kind === 'labour' ? (
                            <span className="rounded-full bg-[var(--amber-soft)] px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--amber)]">Labour suggestion</span>
                          ) : line.kind === 'expense' ? (
                            <span className="rounded-full bg-[var(--primary-soft)] px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[var(--primary)]">Bill / expense</span>
                          ) : null}
                        </div>
                        {line.kind === 'labour' ? (
                          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--text-sub)]">This is an editable suggestion from internal calculations. Change it or remove it without changing stored billing hours.</p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="!text-[var(--red)] hover:!bg-[var(--red-soft)]"
                        aria-label={`Remove charge ${index + 1}`}
                        onClick={() => setDraftLines((current) => current.filter((item) => item.clientKey !== line.clientKey))}
                      >
                        Remove
                      </Button>
                    </div>

                    <div className="grid gap-x-3 sm:grid-cols-2">
                      <div className={lineJobOptions.length > 1 ? '' : 'sm:col-span-2'}>
                        <FieldLabel htmlFor={`${prefix}-description`}>Description</FieldLabel>
                        <Input
                          id={`${prefix}-description`}
                          value={line.description}
                          maxLength={500}
                          onChange={(event) => updateDraftLine(line.clientKey, { description: event.target.value })}
                        />
                      </div>
                      {lineJobOptions.length > 1 ? (
                        <div>
                          <FieldLabel htmlFor={`${prefix}-job`}>Job</FieldLabel>
                          <Select id={`${prefix}-job`} value={line.financeId} onChange={(event) => updateDraftLine(line.clientKey, { financeId: event.target.value })}>
                            {lineJobOptions.map((job) => <option key={job.financeId} value={job.financeId}>{job.jobName} — {job.siteName || 'Site not set'}</option>)}
                          </Select>
                        </div>
                      ) : null}
                      <div className="sm:col-span-2">
                        <Checkbox
                          label="Show quantity and rate on the invoice"
                          checked={line.showQuantityAndRate}
                          onChange={(checked) => setLineQuantityVisibility(line, checked)}
                        />
                        <FieldHint>Leave this off to show only the description and total amount.</FieldHint>
                      </div>
                      {line.showQuantityAndRate ? (
                        <>
                          <div>
                            <FieldLabel htmlFor={`${prefix}-quantity`}>Quantity</FieldLabel>
                            <Input id={`${prefix}-quantity`} type="number" min="0.0001" step="any" inputMode="decimal" value={line.quantity} onChange={(event) => updateDraftLine(line.clientKey, { quantity: event.target.value })} />
                          </div>
                          <div>
                            <FieldLabel htmlFor={`${prefix}-rate`}>Rate ex GST</FieldLabel>
                            <Input id={`${prefix}-rate`} type="number" min="0" step="0.01" inputMode="decimal" value={line.unitAmountExGst} onChange={(event) => updateDraftLine(line.clientKey, { unitAmountExGst: event.target.value })} />
                          </div>
                        </>
                      ) : (
                        <div className="sm:col-span-2 sm:max-w-sm">
                          <FieldLabel htmlFor={`${prefix}-amount`}>Amount ex GST</FieldLabel>
                          <Input id={`${prefix}-amount`} type="number" min="0" step="0.01" inputMode="decimal" value={line.amountExGst} onChange={(event) => updateDraftLine(line.clientKey, { amountExGst: event.target.value })} />
                        </div>
                      )}
                    </div>
                    <p className="mt-3 border-t border-[var(--border)] pt-3 text-right text-sm text-[var(--text-sub)]">
                      Line total <strong className="ml-2 text-[var(--text)]">{Number.isFinite(total) ? money(total, invoice.currency) : '—'}</strong>
                    </p>
                  </article>
                );
              })}
            </div>
          )
        ) : (
          <>
            <div className="mt-4 space-y-2 md:hidden">
            {invoice.lines.map((line) => (
              <div key={line.id} className="rounded-xl border border-[var(--border)] p-3 text-sm">
                <p className="font-bold text-[var(--text)]">{line.description}</p>
                {line.showQuantityAndRate ? <p className="mt-1 text-[var(--text-sub)]">{line.quantity} × {money(line.unitAmountExGst, invoice.currency)}</p> : null}
                <p className="mt-1 font-extrabold text-[var(--text)]">{money(line.lineTotalExGst, invoice.currency)}</p>
              </div>
            ))}
            </div>
            <div className="mt-4 hidden overflow-x-auto md:block">
            <table className={`w-full text-left text-sm ${hasVisibleQuantityAndRate ? 'min-w-[560px]' : 'min-w-[360px]'}`}>
              <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--text-sub)]"><th className="py-2 pr-2">Description</th>{hasVisibleQuantityAndRate ? <><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Unit ex GST</th></> : null}<th className="py-2 text-right">Amount</th></tr></thead>
              <tbody>{invoice.lines.map((line) => <tr key={line.id} className="border-b border-[var(--border)]/70"><td className="py-3 pr-2 font-semibold">{line.description}</td>{hasVisibleQuantityAndRate ? <><td className="py-3 pr-2 text-right">{line.showQuantityAndRate ? line.quantity : '—'}</td><td className="py-3 pr-2 text-right">{line.showQuantityAndRate ? money(line.unitAmountExGst, invoice.currency) : '—'}</td></> : null}<td className="py-3 text-right font-extrabold">{money(line.lineTotalExGst, invoice.currency)}</td></tr>)}</tbody>
            </table>
            </div>
          </>
        )}
      </section>

      {editable ? (
        <>
          <FieldLabel htmlFor={`invoice-notes-${invoice.id}`}>Invoice notes</FieldLabel>
          <Textarea id={`invoice-notes-${invoice.id}`} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          <FieldHint>These notes and the customer-facing charges above are saved together as one draft revision.</FieldHint>
        </>
      ) : invoice.notes ? <div className="mt-4 rounded-xl bg-[var(--surface2)] p-3 text-sm"><strong>Notes</strong><p className="mt-1 whitespace-pre-line text-[var(--text-sub)]">{invoice.notes}</p></div> : null}

      {validation ? <div className="mt-4"><ErrorBanner message={validation} /></div> : null}
      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {pdfExport.error ? <div className="mt-4"><ErrorBanner message={cloudConnectionErrorMessage(pdfExport.error)} /></div> : null}
      {editable && dirty ? (
        <p className="mt-3 text-xs font-semibold text-[var(--amber)]">Save invoice changes before issuing or preparing a PDF so the generated draft or final version uses the values shown here.</p>
      ) : null}
      {editable && !everyJobHasPositiveDraftCharge ? (
        <p className="mt-3 text-xs font-semibold leading-5 text-[var(--amber)]">This draft can be saved, but every included job needs a positive charge before the invoice can be issued.</p>
      ) : null}
      <ExportJobStatus
        job={pdfExport.job}
        artifactName={pdfArtifactName}
        starting={pdfExport.starting}
        downloading={pdfExport.downloading}
        onDownload={() => void downloadPdf()}
        className="mt-5"
      />

      {(invoice.status !== 'void' || (emailDeliveries.data?.length ?? 0) > 0) ? (
        <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4" aria-labelledby={`invoice-email-${invoice.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 id={`invoice-email-${invoice.id}`} className="font-extrabold text-[var(--text)]">Email final invoice</h4>
              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
                {invoice.status === 'draft'
                  ? 'Choose recipients now and the final branded PDF can be generated and emailed automatically after issue.'
                  : 'The immutable final branded PDF is attached and sent through the existing Sustainability Wise Gmail account.'}
              </p>
            </div>
            {invoice.status === 'issued' || invoice.status === 'paid' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={invoiceActionBusy}
                aria-expanded={emailOpen}
                aria-controls={`invoice-email-panel-${invoice.id}`}
                onClick={() => setEmailOpen((open) => !open)}
              >
                {emailOpen ? 'Close email' : 'Email invoice'}
              </Button>
            ) : null}
          </div>
          {editable ? (
            <div className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-3">
              <Checkbox
                label={invoice.status === 'draft'
                  ? 'Email the final invoice automatically after issue'
                  : 'Email the new final invoice automatically after reissue'}
                checked={emailFinalWhenReady}
                disabled={emailRetryLocked}
                onChange={setEmailFinalWhenReady}
              />
              <FieldHint>This option is off by default. The invoice is issued first; the durable email request is then queued with its final PDF.</FieldHint>
            </div>
          ) : null}
          {emailRetryLocked && !emailOpen ? (
            <p className="mt-3 rounded-lg border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--text)]">
              An email request needs an exact retry. Reopen it before marking this invoice paid or void.
            </p>
          ) : null}
          {emailOpen || (editable && emailFinalWhenReady) ? (
            <div id={`invoice-email-panel-${invoice.id}`} className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <FieldLabel htmlFor={`invoice-email-to-${invoice.id}`}>Recipients</FieldLabel>
              <Input id={`invoice-email-to-${invoice.id}`} type="email" multiple autoComplete="email" value={emailTo} disabled={emailRetryLocked} onChange={(event) => setEmailTo(event.target.value)} />
              <FieldHint>Enter up to 10 email addresses separated by commas.</FieldHint>
              <FieldLabel htmlFor={`invoice-email-subject-${invoice.id}`}>Subject</FieldLabel>
              <Input id={`invoice-email-subject-${invoice.id}`} maxLength={300} value={emailSubject} disabled={emailRetryLocked} onChange={(event) => setEmailSubject(event.target.value)} />
              <FieldLabel htmlFor={`invoice-email-message-${invoice.id}`}>Message</FieldLabel>
              <Textarea id={`invoice-email-message-${invoice.id}`} rows={6} maxLength={4_000} value={emailMessage} disabled={emailRetryLocked} onChange={(event) => setEmailMessage(event.target.value)} />
              <FieldHint>{emailRetryLocked
                ? 'The exact request is retained for this browser tab. Retry it unchanged so a lost response cannot create a duplicate email.'
                : 'Ambiguous provider outcomes are never sent again automatically; they are flagged for review to avoid duplicate customer emails.'}</FieldHint>
              {invoice.status === 'issued' || invoice.status === 'paid' ? (
                <div className="mt-4 flex justify-end gap-2">
                  <Button type="button" variant="secondary" disabled={sendEmail.isPending} onClick={() => setEmailOpen(false)}>Cancel</Button>
                  <Button type="button" disabled={sendEmail.isPending} aria-busy={sendEmail.isPending} onClick={() => void emailInvoice()}>{sendEmail.isPending ? 'Queueing…' : emailRetryLocked ? 'Retry same request' : 'Send final invoice'}</Button>
                </div>
              ) : (
                <p className="mt-4 text-xs font-semibold text-[var(--text-sub)]">Recipients and message will be used when you choose “Issue &amp; generate final PDF”.</p>
              )}
            </div>
          ) : null}
          {emailDeliveries.isLoading ? <Spinner label="Loading email delivery history…" /> : null}
          {emailDeliveries.error ? <div className="mt-3"><ErrorBanner message={cloudConnectionErrorMessage(emailDeliveries.error)} /></div> : null}
          {(emailDeliveries.data ?? []).length > 0 ? (
            <ul className="mt-4 space-y-2" aria-label="Invoice email delivery history">
              {(emailDeliveries.data ?? []).slice(0, 5).map((delivery) => (
                <li key={delivery.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[var(--text)]">{delivery.recipient}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-sub)]">{delivery.subject}</p>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">Requested {displayDate(delivery.createdAt)} by {delivery.requestedByDisplayName || 'Admin'}</p>
                    {delivery.status === 'delivery_unknown' ? <p className="mt-1 text-xs font-semibold text-[var(--red)]">Check the recipient inbox before trying again; Gmail may have accepted this message.</p> : null}
                    {delivery.status === 'failed' && delivery.lastErrorCode ? <p className="mt-1 text-xs font-semibold text-[var(--red)]">Delivery failed: {delivery.lastErrorCode.replaceAll('_', ' ')}</p> : null}
                  </div>
                  <EmailDeliveryBadge status={delivery.status} />
                </li>
              ))}
            </ul>
          ) : !emailDeliveries.isLoading ? <p className="mt-3 text-xs text-[var(--text-sub)]">No email delivery attempts yet.</p> : null}
        </section>
      ) : null}

      <InvoiceRefundsPanel invoice={invoice} onChanged={onRefresh} />

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={invoiceActionBusy || dirty || (editable && !allJobsCompleted)}
          aria-busy={pdfExport.starting || pdfExport.active}
          onClick={() => void preparePdf()}
        >
          {editable && !allJobsCompleted
            ? 'Complete jobs before PDF'
            : dirty
            ? 'Save draft before PDF'
            : pdfExport.starting || pdfExport.active
            ? 'Preparing PDF…'
            : pdfExport.job?.status === 'failed'
              ? `Try ${invoice.status === 'draft' ? 'draft' : 'final'} PDF again`
              : pdfExport.job?.status === 'complete'
                ? `Prepare new ${invoice.status === 'draft' ? 'draft' : 'final'} PDF`
                : `Prepare ${invoice.status === 'draft' ? 'draft' : 'final'} PDF`}
        </Button>
        {editable ? <Button type="button" variant="secondary" disabled={invoiceActionBusy} onClick={() => void saveDraft()}>{busy ? 'Saving…' : 'Save invoice'}</Button> : null}
        {editable ? <Button type="button" disabled={invoiceActionBusy || dirty || !allJobsCompleted || !everyJobHasPositiveDraftCharge} onClick={() => void issueInvoice()}>{!allJobsCompleted ? 'Complete jobs before issue' : !everyJobHasPositiveDraftCharge ? 'Add positive charges to issue' : dirty ? 'Save invoice first' : busy ? 'Issuing…' : invoice.status === 'issued' ? 'Reissue & generate new final PDF' : 'Issue & generate final PDF'}</Button> : null}
        {invoice.status === 'issued' ? <Button type="button" disabled={invoiceLifecycleBusy} title={emailRetryLocked ? 'Resolve the retained email request before changing invoice status' : undefined} onClick={() => void onMarkPaid()}>{busy ? 'Updating…' : 'Mark paid'}</Button> : null}
        {(invoice.status === 'draft' || invoice.status === 'issued') ? <Button type="button" variant="danger" disabled={invoiceLifecycleBusy} title={emailRetryLocked ? 'Resolve the retained email request before changing invoice status' : undefined} onClick={() => void onVoid()}>{busy ? 'Voiding…' : 'Void'}</Button> : null}
      </div>
    </article>
  );
}

function EmailDeliveryBadge({ status }: { status: import('@/modules/scheduler/types/domain').SchedulerInvoiceEmailStatus }) {
  const labels = {
    queued: 'Queued',
    processing: 'Sending',
    sent: 'Sent',
    failed: 'Failed',
    delivery_unknown: 'Needs review',
  } as const;
  const className = status === 'sent'
    ? 'bg-[var(--green-soft)] text-[var(--green)]'
    : status === 'failed' || status === 'delivery_unknown'
      ? 'bg-[var(--red-soft)] text-[var(--red)]'
      : 'bg-[var(--primary-soft)] text-[var(--primary)]';
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${className}`}>{labels[status]}</span>;
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-[var(--surface2)] p-3 text-sm text-[var(--text-sub)]">
      <span className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted)]">{label}</span>
      {children}
    </div>
  );
}
