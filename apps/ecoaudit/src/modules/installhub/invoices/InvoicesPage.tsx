'use client';

import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/Button';
import { ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useFinancialSummary } from '@/modules/installhub/finance/hooks';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { useInvoices } from '@/modules/installhub/invoices/hooks';
import { QuickInvoicePanel } from '@/modules/installhub/invoices/QuickInvoicePanel';
import type { InvoiceListItem, InvoiceStatus } from '@/modules/installhub/invoices/types';

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function statusClass(status: InvoiceStatus): string {
  if (status === 'issued') return 'bg-[var(--green-soft)] text-[var(--green)]';
  if (status === 'void') return 'bg-[var(--red-soft,var(--amber-soft))] text-[var(--red)]';
  return 'bg-[var(--amber-soft)] text-[var(--text)]';
}

function InvoiceRow({
  installationId,
  item,
}: {
  installationId: string;
  item: InvoiceListItem;
}) {
  return (
    <a
      href={`/installhub/installations/${installationId}/invoices/${item.id}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition hover:border-[var(--primary)]"
    >
      <div>
        <div className="font-extrabold text-[var(--text)]">{item.invoiceNumber}</div>
        <div className="mt-0.5 text-xs text-[var(--text-sub)]">
          {item.issueDate
            ? `Issued ${new Date(item.issueDate).toLocaleDateString('en-AU')}`
            : `Created ${new Date(item.createdAt).toLocaleDateString('en-AU')}`}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${statusClass(item.status)}`}>
          {item.status}
        </span>
        <span className="font-bold text-[var(--text)]">
          {money(item.totalIncGst, item.currency)}
        </span>
      </div>
    </a>
  );
}

export function InstallHubInvoicesPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const { user } = useInstallHubAuth();
  const canEdit = user?.role === 'admin';
  const invoicesQuery = useInvoices(installationId);
  const summaryQuery = useFinancialSummary(installationId);

  if (invoicesQuery.isLoading || summaryQuery.isLoading) {
    return <Spinner label="Loading invoices…" />;
  }
  if (invoicesQuery.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(invoicesQuery.error)} />;
  }

  const items = invoicesQuery.data?.items ?? [];
  const summary = summaryQuery.data;
  const siteName = summary?.installation.siteName ?? 'Installation';

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Installations', href: '/installhub/installations' },
          { label: siteName, href: `/installhub/installations/${installationId}` },
          { label: 'Invoices' },
        ]}
      />
      <PageHeader
        title="Invoices"
        subtitle="Draft, issue, and download tax invoices from tracked costs and hours."
        actions={
          <>
            <LinkButton
              href={`/installhub/installations/${installationId}/financials`}
              variant="secondary"
            >
              Financial summary
            </LinkButton>
            <LinkButton href={`/installhub/installations/${installationId}`} variant="secondary">
              Back to installation
            </LinkButton>
          </>
        }
      />

      {summary ? (
        <QuickInvoicePanel
          installationId={installationId}
          currency={summary.currency}
          lines={summary.lines}
          canEdit={canEdit}
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--muted)]">
          All invoices
        </h2>
        {!items.length ? (
          <p className="text-sm text-[var(--text-sub)]">No invoices yet. Use Quick invoice above.</p>
        ) : (
          items.map((item) => (
            <InvoiceRow key={item.id} installationId={installationId} item={item} />
          ))
        )}
      </section>
    </div>
  );
}
