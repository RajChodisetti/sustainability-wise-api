'use client';

import { useParams } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { downloadFinancialSummaryCsv } from '@/modules/installhub/finance/api';
import { CostLinesPanel } from '@/modules/installhub/finance/CostLinesPanel';
import { FinanceHeaderForm } from '@/modules/installhub/finance/FinanceHeaderForm';
import { useFinancialSummary } from '@/modules/installhub/finance/hooks';
import type { FinancialSummary } from '@/modules/installhub/finance/types';
import { QuickInvoicePanel } from '@/modules/installhub/invoices/QuickInvoicePanel';

export function InstallHubFinancialSummaryPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const { user } = useInstallHubAuth();
  const query = useFinancialSummary(installationId);
  const canEdit = user?.role === 'admin';

  if (query.isLoading) return <Spinner label="Loading financial summary…" />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Financial summary not found." />;

  const s = query.data;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Installations', href: '/installhub/installations' },
          { label: s.installation.siteName, href: `/installhub/installations/${installationId}` },
          { label: 'Financial Summary' },
        ]}
      />
      <PageHeader
        title="Financial Summary"
        subtitle={`${s.installation.clientName} · ${s.installation.siteAddress}`}
        actions={
          <>
            <LinkButton
              href={`/installhub/installations/${installationId}`}
              variant="secondary"
            >
              Back to installation
            </LinkButton>
            <LinkButton
              href={`/installhub/installations/${installationId}/invoices`}
              variant="secondary"
            >
              View invoices
            </LinkButton>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void downloadFinancialSummaryCsv(installationId).then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `financial-summary-${installationId}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                });
              }}
            >
              Download CSV
            </Button>
          </>
        }
      />

      <OverallPosition summary={s} />

      <QuickInvoicePanel
        installationId={installationId}
        currency={s.currency}
        lines={s.lines}
        canEdit={canEdit}
      />

      {s.autoLabour.enabled ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <h3 className="font-extrabold text-[var(--text)]">Auto labour</h3>
          <p className="mt-1 text-[var(--text-sub)]">
            From job start through {s.installation.status === 'Completed' ? 'complete' : 'today'}:{' '}
            <strong className="text-[var(--text)]">{s.autoLabour.calendarDays}</strong> day(s) ×{' '}
            <strong className="text-[var(--text)]">{s.autoLabour.hoursPerDay}h</strong> ×{' '}
            <strong className="text-[var(--text)]">
              {money(s.autoLabour.hourlyRate, s.currency)}/h
            </strong>{' '}
            = <strong className="text-[var(--text)]">{money(s.autoLabour.costAmount, s.currency)}</strong>
            {' '}({s.autoLabour.hours}h). Hours/day and rate come from server ENV
            (`IH_LABOUR_HOURS_PER_DAY`, `IH_LABOUR_HOURLY_RATE`).
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricTable
          title="Overview"
          rows={[
            {
              label: 'Billable/Priced Amount',
              value: money(s.billablePricedAmount, s.currency),
              tip: 'Quote total (quoted) or sell total of billable costs (charge-up).',
            },
            {
              label: 'Invoiced Costs',
              value: money(s.invoicedCosts, s.currency),
              tip: 'Sum of cost lines marked invoiced.',
            },
            {
              label: 'Uninvoiced Costs',
              value: money(s.uninvoicedCosts, s.currency),
              tip: 'Billable costs not yet marked invoiced.',
            },
            {
              label: 'Uninvoicable Costs',
              value: money(s.uninvoicableCosts, s.currency),
              tip: 'Non-billable costs (e.g. uncharged labour).',
            },
            {
              label: 'Potential Profit',
              value: money(s.potentialProfit, s.currency),
              tip: 'Running estimate — not final profit until all costs and billing are complete.',
            },
            {
              label: 'Credit Applied',
              value: money(s.creditApplied, s.currency),
              tip: 'Not tracked in MVP (always zero).',
            },
          ]}
        />
        <MetricTable
          title="Profit margins"
          rows={[
            {
              label: 'Billable/Priced Margin',
              value: pct(s.billablePricedMarginPct),
              tip: 'Potential profit ÷ billable/priced amount.',
            },
            {
              label: 'Current Margin to Date',
              value: pct(s.currentMarginToDatePct),
              tip: 'Margin on invoiced billable vs invoiced costs.',
            },
            {
              label: 'Margin Breathing Room',
              value: pct(s.marginBreathingRoomPct),
              tip: 'Current margin minus priced margin.',
            },
          ]}
        />
        <MetricTable
          title="Invoiced"
          rows={[
            {
              label: 'Billable/Priced Amount',
              value: money(s.billablePricedAmount, s.currency),
              tip: 'Same as overview billable total.',
            },
            {
              label: 'Invoiced Billable',
              value: money(s.invoicedBillable, s.currency),
              tip: 'Sell (or provisional sell) on invoiced billable lines.',
            },
            {
              label: 'Uninvoiced Billable',
              value: money(s.uninvoicedBillable, s.currency),
              tip: 'Remaining billable to invoice.',
            },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricTable
          title="Spent costs"
          rows={[
            {
              label: 'Total Current Costs',
              value: money(s.totalCurrentCosts, s.currency),
              tip: 'All logged costs including non-billable.',
            },
            {
              label: 'Labour Cost',
              value: money(s.labour.cost, s.currency),
              tip: `Hours logged: ${s.labour.hours}. Uncharged: ${money(s.labour.unchargedCost, s.currency)}.`,
            },
            {
              label: 'Material Cost',
              value: money(s.material.cost, s.currency),
              tip: 'Sum of material cost lines.',
            },
            {
              label: 'Scheduled Hours',
              value: String(s.scheduledHours),
              tip: 'Hours from linked Scheduler events for this installation.',
            },
          ]}
        />
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-extrabold text-[var(--text)]">Labour vs material</h3>
          <div className="mt-4 space-y-3">
            <SplitBar
              label="Cost"
              left={s.labour.cost}
              right={s.material.cost}
              currency={s.currency}
            />
            <SplitBar
              label="Sell"
              left={s.labour.sell}
              right={s.material.sell}
              currency={s.currency}
            />
          </div>
        </div>
      </div>

      <FinanceHeaderForm
        installationId={installationId}
        header={s.header}
        canEdit={canEdit}
      />
      <CostLinesPanel
        installationId={installationId}
        lines={s.lines}
        currency={s.currency}
        canEdit={canEdit}
      />
    </div>
  );
}

function OverallPosition({ summary: s }: { summary: FinancialSummary }) {
  const costParts = [
    { key: 'invoiced', label: 'Invoiced cost', value: s.invoicedCosts, className: 'bg-teal-700' },
    { key: 'uninvoiced', label: 'Uninvoiced cost', value: s.uninvoicedCosts, className: 'bg-teal-400' },
    { key: 'uninvoicable', label: 'Uninvoicable', value: s.uninvoicableCosts, className: 'bg-[var(--muted)]' },
    {
      key: 'profit',
      label: 'Potential profit',
      value: Math.max(0, s.potentialProfit),
      className: 'bg-[var(--surface2)]',
    },
  ];
  const billableParts = [
    { key: 'inv', label: 'Invoiced', value: s.invoicedBillable, className: 'bg-teal-700' },
    { key: 'unin', label: 'Uninvoiced', value: s.uninvoicedBillable, className: 'bg-teal-400' },
  ];

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-base font-extrabold text-[var(--text)]">Overall position</h2>
      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        <p>
          <span className="font-extrabold text-[var(--text)]">
            {money(s.potentialProfit, s.currency)}
          </span>{' '}
          <span className="text-[var(--text-sub)]">Current potential profit</span>
          {s.billablePricedMarginPct != null ? (
            <span className="text-[var(--text-sub)]"> ({s.billablePricedMarginPct}%)</span>
          ) : null}
        </p>
        <p>
          <span className="font-extrabold text-[var(--text)]">
            {money(s.uninvoicedCosts, s.currency)}
          </span>{' '}
          <span className="text-[var(--text-sub)]">Costs uninvoiced</span>
        </p>
      </div>
      <div className="mt-5 space-y-4">
        <StackedBar title="Cost vs potential profit" parts={costParts} />
        <StackedBar title="Billable" parts={billableParts} />
      </div>
    </section>
  );
}

function StackedBar({
  title,
  parts,
}: {
  title: string;
  parts: Array<{ key: string; label: string; value: number; className: string }>;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-[var(--text-sub)]">{title}</p>
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--surface2)]">
        {parts.map((p) => {
          const w = (Math.max(0, p.value) / total) * 100;
          if (w <= 0) return null;
          return (
            <div
              key={p.key}
              className={p.className}
              style={{ width: `${w}%` }}
              title={`${p.label}: ${p.value}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-semibold text-[var(--text-sub)]">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${p.className}`} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SplitBar({
  label,
  left,
  right,
  currency,
}: {
  label: string;
  left: number;
  right: number;
  currency: string;
}) {
  const total = left + right || 1;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-bold text-[var(--text-sub)]">
        <span>{label}</span>
        <span>
          Labour {money(left, currency)} · Material {money(right, currency)}
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--surface2)]">
        <div className="bg-[var(--primary)]" style={{ width: `${(left / total) * 100}%` }} />
        <div className="bg-amber-500" style={{ width: `${(right / total) * 100}%` }} />
      </div>
    </div>
  );
}

function MetricTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string; tip: string }>;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-extrabold text-[var(--text)]">{title}</h3>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3 text-sm">
            <dt className="text-[var(--text-sub)]" title={row.tip}>
              {row.label}{' '}
              <span className="cursor-help text-[10px] text-[var(--muted)]" aria-label={row.tip}>
                ?
              </span>
            </dt>
            <dd className="font-extrabold text-[var(--text)]">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
}

function pct(n: number | null): string {
  if (n == null) return '—';
  return `${n}%`;
}
