'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { downloadInvoicePdf } from '@/modules/installhub/invoices/api';
import {
  useInvoice,
  useIssueInvoice,
  useVoidInvoice,
} from '@/modules/installhub/invoices/hooks';

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function InstallHubInvoiceDetailPage() {
  const { installationId, invoiceId } = useParams<{
    installationId: string;
    invoiceId: string;
  }>();
  const { user } = useInstallHubAuth();
  const canEdit = user?.role === 'admin';
  const query = useInvoice(installationId, invoiceId);
  const issue = useIssueInvoice(installationId);
  const voidMut = useVoidInvoice(installationId);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  if (query.isLoading) return <Spinner label="Loading invoice…" />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Invoice not found." />;

  const inv = query.data;
  const gstPct = Math.round(inv.gstRate * 1000) / 10;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Installations', href: '/installhub/installations' },
          {
            label: inv.installation.siteName,
            href: `/installhub/installations/${installationId}`,
          },
          { label: 'Invoices', href: `/installhub/installations/${installationId}/invoices` },
          { label: inv.invoiceNumber },
        ]}
      />
      <PageHeader
        title={inv.invoiceNumber}
        subtitle={`${inv.installation.clientName} · ${inv.status}`}
        actions={
          <>
            <LinkButton
              href={`/installhub/installations/${installationId}/invoices`}
              variant="secondary"
            >
              All invoices
            </LinkButton>
            {inv.status !== 'void' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={downloading}
                onClick={() => {
                  setError(null);
                  setDownloading(true);
                  void downloadInvoicePdf(
                    installationId,
                    invoiceId,
                    `invoice-${inv.installation.siteName}-${inv.installation.auditDate}-${inv.invoiceNumber}`,
                  )
                    .then((file) => {
                      const url = URL.createObjectURL(file.blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = file.filename;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    })
                    .catch((err) => setError(installHubConnectionErrorMessage(err)))
                    .finally(() => setDownloading(false));
                }}
              >
                {downloading ? 'Preparing PDF…' : 'Download PDF'}
              </Button>
            ) : null}
            {canEdit && inv.status === 'draft' ? (
              <Button
                type="button"
                disabled={issue.isPending}
                onClick={() => {
                  setError(null);
                  void issue
                    .mutateAsync(invoiceId)
                    .catch((err) => setError(installHubConnectionErrorMessage(err)));
                }}
              >
                {issue.isPending ? 'Issuing…' : 'Issue invoice'}
              </Button>
            ) : null}
            {canEdit && inv.status !== 'void' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={voidMut.isPending}
                onClick={() => {
                  if (!window.confirm(`Void ${inv.invoiceNumber}?`)) return;
                  setError(null);
                  void voidMut
                    .mutateAsync(invoiceId)
                    .catch((err) => setError(installHubConnectionErrorMessage(err)));
                }}
              >
                {voidMut.isPending ? 'Voiding…' : 'Void'}
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Bill to
          </div>
          <div className="mt-2 font-extrabold text-[var(--text)]">{inv.installation.clientName}</div>
          <div className="text-[var(--text-sub)]">{inv.installation.siteName}</div>
          <div className="text-[var(--text-sub)]">{inv.installation.siteAddress}</div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Dates
          </div>
          <div className="mt-2 text-[var(--text)]">Issue: {formatDate(inv.issueDate)}</div>
          <div className="text-[var(--text)]">Due: {formatDate(inv.dueDate)}</div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Totals
          </div>
          <div className="mt-2 text-[var(--text)]">
            Subtotal: {money(inv.subtotalExGst, inv.currency)}
          </div>
          <div className="text-[var(--text)]">
            GST ({gstPct}%): {money(inv.gstAmount, inv.currency)}
          </div>
          <div className="mt-1 font-extrabold text-[var(--text)]">
            Total: {money(inv.totalIncGst, inv.currency)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <th className="py-2 pr-2 font-bold">Description</th>
              <th className="py-2 pr-2 font-bold">Qty</th>
              <th className="py-2 pr-2 font-bold">Unit (ex GST)</th>
              <th className="py-2 font-bold">Amount (ex GST)</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((line) => (
              <tr key={line.id} className="border-b border-[var(--border)]/70">
                <td className="py-2 pr-2 font-semibold text-[var(--text)]">{line.description}</td>
                <td className="py-2 pr-2">{line.quantity}</td>
                <td className="py-2 pr-2">{money(line.unitAmountExGst, inv.currency)}</td>
                <td className="py-2">{money(line.lineTotalExGst, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inv.notes ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <div className="font-extrabold text-[var(--text)]">Notes</div>
          <p className="mt-1 text-[var(--text-sub)]">{inv.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
