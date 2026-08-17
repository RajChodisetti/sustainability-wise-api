'use client';

import { useMemo, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { Checkbox, FieldHint, FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import {
  downloadSchedulerInvoicePdfExport,
  getLatestSchedulerInvoicePdfExport,
  getSchedulerInvoicePdfExportStatus,
  startSchedulerInvoicePdfExport,
} from '@/modules/scheduler/api/client';
import {
  useCreateQuickSchedulerInvoice,
  useIssueSchedulerInvoice,
  useMarkSchedulerInvoicePaid,
  useSchedulerInvoice,
  useSchedulerInvoiceEmailDeliveries,
  useSchedulerInvoices,
  useSendSchedulerInvoiceEmail,
  useUpdateSchedulerInvoice,
  useVoidSchedulerInvoice,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  availableInvoiceExpenses,
  consolidatedInvoiceRecipientIssue,
  financeAppLabel,
  invoiceDraftIsDirty,
  invoiceEmailAttemptNeedsSameIdempotencyKey,
  invoiceStatusLabel,
  schedulerFinanceHref,
  schedulerInvoicePdfFallbackFilename,
  schedulerInvoicePdfReportVariantKey,
} from '@/modules/scheduler/lib/finance';
import type {
  SchedulerFinancialSummary,
  SchedulerInvoice,
  SchedulerInvoiceListItem,
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
  const [includeLabour, setIncludeLabour] = useState(true);
  const [draftNotes, setDraftNotes] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDraft() {
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
          <p className="mt-1 text-sm text-[var(--text-sub)]">Draft, issue, download, mark paid, and retain immutable issued snapshots.</p>
        </div>
        <Button type="button" onClick={() => {
          if (!quickOpen) setSelectedExpenseIds(availableExpenses.map((expense) => expense.id));
          setQuickOpen(!quickOpen);
        }}>
          {quickOpen ? 'Close draft setup' : '+ New invoice'}
        </Button>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

      {quickOpen ? (
        <div className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface2)] p-4">
          <h3 className="font-extrabold text-[var(--text)]">Create invoice draft</h3>
          <p className="mt-1 text-sm text-[var(--text-sub)]">
            {summary.pricing.mode === 'quoted'
              ? 'Include the remaining quote balance and any selected billable expenses.'
              : 'Include effective billable labour and any selected billable expenses.'}
          </p>
          <Checkbox
            label={summary.pricing.mode === 'quoted' ? 'Include remaining quote balance' : 'Include billable labour'}
            checked={includeLabour}
            onChange={setIncludeLabour}
          />
          {summary.time.needsHoursReview && summary.pricing.mode === 'charge_up' && includeLabour ? (
            <p className="rounded-lg bg-[var(--amber-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--amber)]">
              Hours need review. Confirm recorded time or add an audited override before issuing this draft.
            </p>
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
            <Button type="button" disabled={create.isPending || (!includeLabour && selectedExpenseIds.length === 0)} onClick={() => void createDraft()}>
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
  onClose,
}: {
  financeId: string;
  invoiceId: string;
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
      busy={update.isPending || issue.isPending || markPaid.isPending || voidInvoice.isPending}
      error={error}
      onClose={onClose}
      onRefresh={async () => { await query.refetch(); }}
      onSave={async (input) => {
        setError(null);
        try {
          await update.mutateAsync({
            invoiceId,
            input: { ...input, expectedUpdatedAt: query.data.updatedAt },
          });
          toast.success('Draft invoice saved.');
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
        }
      }}
      onIssue={async () => {
        if (!window.confirm(`Issue ${query.data.invoiceNumber}? Issued billing and line details cannot be edited.`)) return;
        setError(null);
        try {
          await issue.mutateAsync({
            invoiceId,
            expectedUpdatedAt: query.data.updatedAt,
          });
          toast.success(`${query.data.invoiceNumber} issued.`);
        } catch (cause) {
          setError(cloudConnectionErrorMessage(cause));
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
}: {
  financeId: string;
  invoice: SchedulerInvoice;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSave: (input: {
    notes: string | null;
    dueDate: string | null;
    billToName: string;
    billToAddress: string | null;
    billToEmail: string | null;
    billToAbn: string | null;
    purchaseOrderReference: string | null;
  }) => Promise<void>;
  onIssue: () => Promise<void>;
  onMarkPaid: () => Promise<void>;
  onVoid: () => Promise<void>;
  onStartPdf?: () => ReturnType<typeof startSchedulerInvoicePdfExport>;
}) {
  const editable = invoice.status === 'draft';
  const [notes, setNotes] = useState(invoice.notes ?? '');
  const [dueDate, setDueDate] = useState(dateInput(invoice.dueDate));
  const [billToName, setBillToName] = useState(invoice.billToName ?? '');
  const [billToAddress, setBillToAddress] = useState(invoice.billToAddress ?? '');
  const [billToEmail, setBillToEmail] = useState(invoice.billToEmail ?? '');
  const [billToAbn, setBillToAbn] = useState(invoice.billToAbn ?? '');
  const [purchaseOrderReference, setPurchaseOrderReference] = useState(invoice.purchaseOrderReference ?? '');
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
  const toast = useToast();
  const sendEmail = useSendSchedulerInvoiceEmail(invoice.id);
  const emailDeliveries = useSchedulerInvoiceEmailDeliveries(invoice.id, true);
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
    || pdfExport.starting
    || pdfExport.active
    || pdfExport.downloading
    || sendEmail.isPending;
  const invoiceLifecycleBusy = invoiceActionBusy || emailRetryLocked;
  const dirty = editable && invoiceDraftIsDirty({
    notes: invoice.notes ?? '',
    dueDate: dateInput(invoice.dueDate),
    billToName: invoice.billToName ?? '',
    billToAddress: invoice.billToAddress ?? '',
    billToEmail: invoice.billToEmail ?? '',
    billToAbn: invoice.billToAbn ?? '',
    purchaseOrderReference: invoice.purchaseOrderReference ?? '',
  }, { notes, dueDate, billToName, billToAddress, billToEmail, billToAbn, purchaseOrderReference });

  async function saveDraft() {
    if (!billToName.trim()) {
      setValidation('Billing name is required before this draft can be saved or issued.');
      return;
    }
    setValidation(null);
    await onSave({
      notes: notes.trim() || null,
      dueDate: dueDate || null,
      billToName: billToName.trim(),
      billToAddress: billToAddress.trim() || null,
      billToEmail: billToEmail.trim() || null,
      billToAbn: billToAbn.trim() || null,
      purchaseOrderReference: purchaseOrderReference.trim() || null,
    });
  }

  async function preparePdf() {
    try {
      await pdfExport.start(() => onStartPdf
        ? onStartPdf()
        : startSchedulerInvoicePdfExport(financeId, invoice.id, invoice.updatedAt));
      toast.success('Invoice PDF preparation started. You can leave this page while it finishes.');
    } catch (cause) {
      await onRefresh().catch(() => {});
      toast.error(cloudConnectionErrorMessage(cause));
    }
  }

  async function downloadPdf() {
    try {
      await pdfExport.download();
      toast.success('Invoice PDF download started.');
    } catch (cause) {
      toast.error(cloudConnectionErrorMessage(cause));
    }
  }

  async function issueInvoice() {
    const recipientIssue = consolidatedInvoiceRecipientIssue({
      name: invoice.billToName,
    });
    if (recipientIssue) {
      setValidation(recipientIssue);
      return;
    }
    setValidation(null);
    await onIssue();
  }

  async function emailInvoice() {
    const recipient = emailTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setValidation('Enter a valid recipient email address.');
      return;
    }
    if (!emailSubject.trim()) {
      setValidation('Add an email subject.');
      return;
    }
    if (!emailMessage.trim()) {
      setValidation('Add a short email message.');
      return;
    }
    const request = {
      idempotencyKey: emailIdempotencyKey,
      sourceUpdatedAt: emailSourceUpdatedAt,
      recipient,
      subject: emailSubject.trim(),
      message: emailMessage.trim(),
    };
    if (!writePendingInvoiceEmail(emailSessionKey, request)) {
      setValidation('This browser could not safely retain the email request for retry. Enable session storage and try again.');
      return;
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
      setEmailSourceUpdatedAt(invoice.updatedAt);
      setEmailOpen(false);
    } catch (cause) {
      if (!invoiceEmailAttemptNeedsSameIdempotencyKey(cause)) {
        clearPendingInvoiceEmail(emailSessionKey);
        setEmailRetryLocked(false);
        setEmailIdempotencyKey(newInvoiceEmailIdempotencyKey(invoice.id));
        setEmailSourceUpdatedAt(invoice.updatedAt);
      }
      setValidation(cloudConnectionErrorMessage(cause));
    }
  }

  return (
    <article className="min-w-0 rounded-xl border border-[var(--border)] p-4" aria-labelledby={`invoice-${invoice.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`invoice-${invoice.id}`} className="text-lg font-extrabold text-[var(--text)]">{invoice.invoiceNumber}</h3>
            <StatusBadge invoice={invoice} />
          </div>
          <p className="mt-1 text-xs text-[var(--text-sub)]">{invoice.jobCount && invoice.jobCount > 1 ? `${invoice.jobCount} jobs · ${(invoice.jobNames ?? []).join(', ')}` : `${invoice.job.jobName} · ${displayDate(invoice.job.jobDate)}`}</p>
        </div>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
      </div>

      {!editable ? (
        <div className="mt-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-3 py-2.5 text-sm text-[var(--text)]">
          <strong>Immutable {invoiceStatusLabel(invoice.status).toLowerCase()} snapshot.</strong>{' '}
          {invoice.issuedAt
            ? 'Bill-to, seller, job, and line details are retained from issuance and cannot be edited.'
            : 'This voided draft is retained as an audit record and cannot be edited.'}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <InfoBlock label="Bill to">
          <strong>{invoice.billToName || invoice.job.clientName || 'Billing name not set'}</strong>
          <span>{invoice.billToEmail || 'No email'}</span>
          {invoice.billToAbn ? <span>ABN: {invoice.billToAbn}</span> : null}
          <span className="whitespace-pre-line">{invoice.billToAddress || invoice.job.siteAddress || 'No billing address'}</span>
          {invoice.purchaseOrderReference ? <span>Reference: {invoice.purchaseOrderReference}</span> : null}
        </InfoBlock>
        <InfoBlock label="Dates">
          <span>Issued: {displayDate(invoice.issueDate)}</span>
          <span>Due: {displayDate(invoice.dueDate)}</span>
          {invoice.paidAt ? <span>Paid: {displayDate(invoice.paidAt)}</span> : null}
        </InfoBlock>
        <InfoBlock label="Total">
          <span>Subtotal: {money(invoice.subtotalExGst, invoice.currency)}</span>
          <span>GST: {money(invoice.gstAmount, invoice.currency)}</span>
          <strong>{money(invoice.totalIncGst, invoice.currency)} inc GST</strong>
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
                    <h5 className="truncate text-sm font-extrabold text-[var(--text)]">{job.job.jobName}</h5>
                    <p className="mt-0.5 text-xs text-[var(--text-sub)]">{financeAppLabel(job.source.sourceApp)} · {displayDate(job.job.jobDate)}</p>
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
              <FieldLabel htmlFor={`invoice-reference-${invoice.id}`}>PO / customer reference</FieldLabel>
              <Input id={`invoice-reference-${invoice.id}`} value={purchaseOrderReference} onChange={(event) => setPurchaseOrderReference(event.target.value)} />
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
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-sub)]">Charges are read-only here so audited hours, job costs, margins, and invoice reservations stay aligned.</p>
          </div>
          {editable ? (
            <nav className="flex flex-wrap gap-2" aria-label="Change invoice source charges">
              <a className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-extrabold text-[var(--primary)] hover:bg-[var(--primary-soft)]" href={schedulerFinanceHref({ view: 'financial-summary', financeId })}>Edit hours</a>
              <a className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-extrabold text-[var(--primary)] hover:bg-[var(--primary-soft)]" href={schedulerFinanceHref({ view: 'bills', financeId })}>Manage bills & expenses</a>
            </nav>
          ) : null}
        </div>
        {invoice.jobs && invoice.jobs.length > 1 ? (
          <p className="mt-3 text-xs font-semibold text-[var(--text-sub)]">The job-attributed charge breakdown is shown in Included jobs above.</p>
        ) : (
          <>
            <div className="mt-4 space-y-2 md:hidden">
            {invoice.lines.map((line) => (
              <div key={line.id} className="rounded-xl border border-[var(--border)] p-3 text-sm">
                <p className="font-bold text-[var(--text)]">{line.description}</p>
                <p className="mt-1 text-[var(--text-sub)]">{line.quantity} × {money(line.unitAmountExGst, invoice.currency)}</p>
                <p className="mt-1 font-extrabold text-[var(--text)]">{money(line.lineTotalExGst, invoice.currency)}</p>
              </div>
            ))}
            </div>
            <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--text-sub)]"><th className="py-2 pr-2">Description</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Unit ex GST</th><th className="py-2 text-right">Amount</th></tr></thead>
              <tbody>{invoice.lines.map((line) => <tr key={line.id} className="border-b border-[var(--border)]/70"><td className="py-3 pr-2 font-semibold">{line.description}</td><td className="py-3 pr-2 text-right">{line.quantity}</td><td className="py-3 pr-2 text-right">{money(line.unitAmountExGst, invoice.currency)}</td><td className="py-3 text-right font-extrabold">{money(line.lineTotalExGst, invoice.currency)}</td></tr>)}</tbody>
            </table>
            </div>
          </>
        )}
      </section>

      {editable ? (
        <>
          <FieldLabel htmlFor={`invoice-notes-${invoice.id}`}>Invoice notes</FieldLabel>
          <Textarea id={`invoice-notes-${invoice.id}`} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          <FieldHint>Update hours in Financial Summary and add other charges in Bills & Expenses before creating a replacement draft.</FieldHint>
        </>
      ) : invoice.notes ? <div className="mt-4 rounded-xl bg-[var(--surface2)] p-3 text-sm"><strong>Notes</strong><p className="mt-1 whitespace-pre-line text-[var(--text-sub)]">{invoice.notes}</p></div> : null}

      {validation ? <div className="mt-4"><ErrorBanner message={validation} /></div> : null}
      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {pdfExport.error ? <div className="mt-4"><ErrorBanner message={cloudConnectionErrorMessage(pdfExport.error)} /></div> : null}
      {editable && dirty ? (
        <p className="mt-3 text-xs font-semibold text-[var(--amber)]">Save draft changes before issuing or preparing a PDF so the invoice uses the values shown here.</p>
      ) : null}
      <ExportJobStatus
        job={pdfExport.job}
        artifactName="invoice PDF"
        starting={pdfExport.starting}
        downloading={pdfExport.downloading}
        onDownload={() => void downloadPdf()}
        className="mt-5"
      />

      {(invoice.status === 'issued' || invoice.status === 'paid' || (emailDeliveries.data?.length ?? 0) > 0) ? (
        <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4" aria-labelledby={`invoice-email-${invoice.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 id={`invoice-email-${invoice.id}`} className="font-extrabold text-[var(--text)]">Email invoice</h4>
              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">The immutable branded PDF is attached and sent through the existing Sustainability Wise Gmail account.</p>
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
          {emailRetryLocked && !emailOpen ? (
            <p className="mt-3 rounded-lg border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--text)]">
              An email request needs an exact retry. Reopen it before marking this invoice paid or void.
            </p>
          ) : null}
          {emailOpen ? (
            <div id={`invoice-email-panel-${invoice.id}`} className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <FieldLabel htmlFor={`invoice-email-to-${invoice.id}`}>Recipient</FieldLabel>
              <Input id={`invoice-email-to-${invoice.id}`} type="email" autoComplete="email" value={emailTo} disabled={emailRetryLocked} onChange={(event) => setEmailTo(event.target.value)} />
              <FieldLabel htmlFor={`invoice-email-subject-${invoice.id}`}>Subject</FieldLabel>
              <Input id={`invoice-email-subject-${invoice.id}`} maxLength={300} value={emailSubject} disabled={emailRetryLocked} onChange={(event) => setEmailSubject(event.target.value)} />
              <FieldLabel htmlFor={`invoice-email-message-${invoice.id}`}>Message</FieldLabel>
              <Textarea id={`invoice-email-message-${invoice.id}`} rows={6} maxLength={4_000} value={emailMessage} disabled={emailRetryLocked} onChange={(event) => setEmailMessage(event.target.value)} />
              <FieldHint>{emailRetryLocked
                ? 'The exact request is retained for this browser tab. Retry it unchanged so a lost response cannot create a duplicate email.'
                : 'Ambiguous provider outcomes are never sent again automatically; they are flagged for review to avoid duplicate customer emails.'}</FieldHint>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" disabled={sendEmail.isPending} onClick={() => setEmailOpen(false)}>Cancel</Button>
                <Button type="button" disabled={sendEmail.isPending} aria-busy={sendEmail.isPending} onClick={() => void emailInvoice()}>{sendEmail.isPending ? 'Queueing…' : emailRetryLocked ? 'Retry same request' : 'Send invoice'}</Button>
              </div>
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

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={invoiceActionBusy || dirty}
          aria-busy={pdfExport.starting || pdfExport.active}
          onClick={() => void preparePdf()}
        >
          {dirty
            ? 'Save draft before PDF'
            : pdfExport.starting || pdfExport.active
            ? 'Preparing PDF…'
            : pdfExport.job?.status === 'failed'
              ? 'Try PDF again'
              : pdfExport.job?.status === 'complete'
                ? 'Prepare new PDF'
                : 'Prepare PDF'}
        </Button>
        {editable ? <Button type="button" variant="secondary" disabled={invoiceActionBusy} onClick={() => void saveDraft()}>{busy ? 'Saving…' : 'Save draft'}</Button> : null}
        {editable ? <Button type="button" disabled={invoiceActionBusy || dirty} onClick={() => void issueInvoice()}>{dirty ? 'Save draft first' : busy ? 'Issuing…' : 'Issue invoice'}</Button> : null}
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
