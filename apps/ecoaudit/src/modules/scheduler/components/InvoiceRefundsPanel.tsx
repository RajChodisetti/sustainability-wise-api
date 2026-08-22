'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import {
  usePostSchedulerInvoiceRefund,
  useSchedulerInvoiceRefunds,
  useVoidSchedulerInvoiceRefund,
} from '@/modules/scheduler/hooks/useScheduler';
import type { SchedulerInvoice } from '@/modules/scheduler/types/domain';
import type { SchedulerInvoiceRefund } from '@/modules/scheduler/types/refunds';

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function newRefundIdempotencyKey(invoiceId: string): string {
  const nonce = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `scheduler-refund:${invoiceId}:${nonce}`;
}

function displayDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function InvoiceRefundsPanel({
  invoice,
  onChanged,
}: {
  invoice: Pick<
    SchedulerInvoice,
    'id' | 'status' | 'currency' | 'subtotalExGst' | 'gstAmount' | 'totalIncGst' | 'gstRate' | 'updatedAt'
  >;
  onChanged: () => Promise<void>;
}) {
  const query = useSchedulerInvoiceRefunds(invoice.id, invoice.status !== 'draft');
  const postRefund = usePostSchedulerInvoiceRefund(invoice.id);
  const voidRefund = useVoidSchedulerInvoiceRefund(invoice.id);
  const [formOpen, setFormOpen] = useState(false);
  const [amountExGst, setAmountExGst] = useState('');
  const [gstAmount, setGstAmount] = useState('');
  const [reason, setReason] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => newRefundIdempotencyKey(invoice.id));
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refunds = useMemo(() => query.data ?? [], [query.data]);
  const postedTotals = useMemo(() => refunds
    .filter((refund) => refund.status === 'posted')
    .reduce((total, refund) => ({
      exGst: total.exGst + refund.amountExGst,
      gst: total.gst + refund.gstAmount,
      incGst: total.incGst + refund.totalIncGst,
    }), { exGst: 0, gst: 0, incGst: 0 }), [refunds]);
  const remaining = {
    exGst: Math.max(0, invoice.subtotalExGst - postedTotals.exGst),
    gst: Math.max(0, invoice.gstAmount - postedTotals.gst),
    incGst: Math.max(0, invoice.totalIncGst - postedTotals.incGst),
  };
  const busy = postRefund.isPending || voidRefund.isPending;

  if (invoice.status === 'draft') return null;

  function openForm() {
    setError(null);
    setAmountExGst(remaining.exGst.toFixed(2));
    setGstAmount(remaining.gst.toFixed(2));
    setReason('');
    setExternalReference('');
    setFormOpen(true);
  }

  function updateAmountExGst(value: string) {
    setAmountExGst(value);
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      setGstAmount('');
      return;
    }
    const amountCents = Math.round(amount * 100);
    const remainingExGstCents = Math.round(remaining.exGst * 100);
    const gstCents = amountCents === remainingExGstCents
      ? Math.round(remaining.gst * 100)
      : Math.round(amountCents * invoice.gstRate);
    setGstAmount((gstCents / 100).toFixed(2));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsedExGst = Number(amountExGst);
    const parsedGst = Number(gstAmount);
    if (!Number.isFinite(parsedExGst) || parsedExGst < 0 || !Number.isFinite(parsedGst) || parsedGst < 0) {
      setError('Enter non-negative ex-GST and GST amounts.');
      return;
    }
    if (parsedExGst + parsedGst <= 0) {
      setError('The refund total must be greater than zero.');
      return;
    }
    if (!reason.trim()) {
      setError('Enter the reason for this refund.');
      return;
    }
    try {
      await postRefund.mutateAsync({
        idempotencyKey,
        expectedUpdatedAt: invoice.updatedAt,
        amountExGst: parsedExGst,
        gstAmount: parsedGst,
        reason: reason.trim(),
        externalReference: externalReference.trim() || null,
      });
      setIdempotencyKey(newRefundIdempotencyKey(invoice.id));
      setFormOpen(false);
      await onChanged();
    } catch (cause) {
      // Keep the exact idempotency key and payload visible so an ambiguous
      // network result can be retried without posting a duplicate refund.
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  async function confirmVoid(refund: SchedulerInvoiceRefund) {
    setError(null);
    if (!voidReason.trim()) {
      setError('Enter a reason for voiding the refund.');
      return;
    }
    try {
      await voidRefund.mutateAsync({
        refundId: refund.id,
        expectedUpdatedAt: refund.updatedAt,
        reason: voidReason.trim(),
      });
      setVoidingId(null);
      setVoidReason('');
      await onChanged();
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4" aria-labelledby={`invoice-refunds-${invoice.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id={`invoice-refunds-${invoice.id}`} className="font-extrabold text-[var(--text)]">Refunds</h4>
          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
            Refunds retain their ex-GST, GST, currency, effective date, and audit history. They do not rewrite payment status.
          </p>
        </div>
        {(invoice.status === 'issued' || invoice.status === 'paid') && remaining.incGst > 0 ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={formOpen ? () => setFormOpen(false) : openForm}>
            {formOpen ? 'Close refund' : 'Record refund'}
          </Button>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-[var(--surface)] px-3 py-2"><dt className="text-xs text-[var(--text-sub)]">Posted refunds</dt><dd className="mt-1 font-extrabold">{money(postedTotals.incGst, invoice.currency)}</dd></div>
        <div className="rounded-lg bg-[var(--surface)] px-3 py-2"><dt className="text-xs text-[var(--text-sub)]">Remaining inc GST</dt><dd className="mt-1 font-extrabold">{money(remaining.incGst, invoice.currency)}</dd></div>
        <div className="rounded-lg bg-[var(--surface)] px-3 py-2"><dt className="text-xs text-[var(--text-sub)]">Currency</dt><dd className="mt-1 font-extrabold">{invoice.currency}</dd></div>
      </dl>

      {formOpen ? (
        <form className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-4" onSubmit={submit}>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <div><FieldLabel htmlFor={`refund-ex-${invoice.id}`}>Amount ex GST</FieldLabel><Input id={`refund-ex-${invoice.id}`} type="number" min="0.01" step="0.01" inputMode="decimal" value={amountExGst} disabled={busy} onChange={(event) => updateAmountExGst(event.target.value)} /></div>
            <div><FieldLabel htmlFor={`refund-gst-${invoice.id}`}>GST amount (calculated)</FieldLabel><Input id={`refund-gst-${invoice.id}`} type="number" value={gstAmount} readOnly aria-readonly="true" /></div>
          </div>
          <FieldHint>GST follows the invoice&apos;s {(invoice.gstRate * 100).toFixed(2)}% rate. Maximum remaining: {money(remaining.exGst, invoice.currency)} ex GST plus {money(remaining.gst, invoice.currency)} GST.</FieldHint>
          <FieldLabel htmlFor={`refund-reason-${invoice.id}`}>Reason</FieldLabel>
          <Textarea id={`refund-reason-${invoice.id}`} rows={3} maxLength={2000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} />
          <FieldLabel htmlFor={`refund-reference-${invoice.id}`}>External reference (optional)</FieldLabel>
          <Input id={`refund-reference-${invoice.id}`} maxLength={200} value={externalReference} disabled={busy} onChange={(event) => setExternalReference(event.target.value)} />
          <div className="mt-4 flex justify-end"><Button type="submit" disabled={busy}>{postRefund.isPending ? 'Recording…' : 'Post refund'}</Button></div>
        </form>
      ) : null}

      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      {query.isLoading ? <Spinner label="Loading refund history…" /> : null}
      {query.isError ? <div className="mt-3"><ErrorBanner message={cloudConnectionErrorMessage(query.error)} /></div> : null}
      {refunds.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-label="Invoice refund history">
          {refunds.map((refund) => (
            <li key={refund.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-extrabold text-[var(--text)]">{money(refund.totalIncGst, refund.currency)} inc GST</p>
                  <p className="mt-0.5 text-xs text-[var(--text-sub)]">{money(refund.amountExGst, refund.currency)} ex GST · {money(refund.gstAmount, refund.currency)} GST · {displayDate(refund.refundedAt)}</p>
                  <p className="mt-2 text-sm text-[var(--text-sub)]">{refund.reason}</p>
                  {refund.externalReference ? <p className="mt-1 text-xs text-[var(--text-sub)]">Reference: {refund.externalReference}</p> : null}
                  {refund.voidReason ? <p className="mt-1 text-xs font-semibold text-[var(--red)]">Void reason: {refund.voidReason}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${refund.status === 'posted' ? 'bg-[var(--green-soft)] text-[var(--green)]' : 'bg-[var(--red-soft)] text-[var(--red)]'}`}>
                    {refund.status === 'posted' ? 'Posted' : 'Voided'}
                  </span>
                  {refund.status === 'posted' && voidingId !== refund.id ? (
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => { setVoidingId(refund.id); setVoidReason(''); }}>Void</Button>
                  ) : null}
                </div>
              </div>
              {voidingId === refund.id ? (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <FieldLabel htmlFor={`refund-void-reason-${refund.id}`} className="!mt-0">Why is this refund being voided?</FieldLabel>
                  <Input id={`refund-void-reason-${refund.id}`} maxLength={2000} value={voidReason} disabled={busy} onChange={(event) => setVoidReason(event.target.value)} />
                  <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setVoidingId(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void confirmVoid(refund)}>{voidRefund.isPending ? 'Voiding…' : 'Void refund'}</Button></div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !query.isLoading && !query.isError ? <p className="mt-3 text-xs text-[var(--text-sub)]">No refunds recorded.</p> : null}
    </section>
  );
}
