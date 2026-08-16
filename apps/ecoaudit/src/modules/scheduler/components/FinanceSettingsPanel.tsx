'use client';

import { useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { useUpdateSchedulerFinance } from '@/modules/scheduler/hooks/useScheduler';
import {
  resolveHourOverrideValues,
  shouldAttachHourOverrideReason,
} from '@/modules/scheduler/lib/finance';
import type {
  FinancePricingMode,
  SchedulerFinancialSummary,
  UpdateSchedulerFinanceInput,
} from '@/modules/scheduler/types/domain';

function numberValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function ProvenanceBadge({
  source,
}: {
  source: 'actual' | 'override';
}) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
      source === 'override'
        ? 'bg-[var(--amber-soft)] text-[var(--amber)]'
        : 'bg-[var(--green-soft)] text-[var(--green)]'
    }`}>
      {source === 'override' ? 'Override' : 'Recorded'}
    </span>
  );
}

export function FinanceSettingsPanel({
  financeId,
  summary,
}: {
  financeId: string;
  summary: SchedulerFinancialSummary;
}) {
  const toast = useToast();
  const save = useUpdateSchedulerFinance(financeId);
  const [pricingMode, setPricingMode] = useState<FinancePricingMode>(summary.pricing.mode);
  const [quotedAmount, setQuotedAmount] = useState(summary.pricing.quotedAmount?.toString() ?? '');
  const [currency, setCurrency] = useState(summary.currency);
  const [notes, setNotes] = useState(summary.pricing.notes ?? '');
  const [billableOverride, setBillableOverride] = useState(
    summary.time.billableHoursOverride?.toString() ?? '',
  );
  const [costOverride, setCostOverride] = useState(summary.time.costHoursOverride?.toString() ?? '');
  const [billableRate, setBillableRate] = useState(summary.time.billableRate.toString());
  const [costRate, setCostRate] = useState(summary.time.costRate.toString());
  const [overrideReason, setOverrideReason] = useState('');
  const [billingName, setBillingName] = useState(summary.billing.name ?? '');
  const [billingAddress, setBillingAddress] = useState(summary.billing.address ?? '');
  const [billingEmail, setBillingEmail] = useState(summary.billing.email ?? '');
  const [billingReference, setBillingReference] = useState(summary.billing.reference ?? '');
  const [error, setError] = useState<string | null>(null);

  const nextBillableOverride = numberValue(billableOverride);
  const nextCostOverride = numberValue(costOverride);
  const basePayload = (options?: {
    billableHoursOverride: number | null;
    costHoursOverride: number | null;
  }): UpdateSchedulerFinanceInput | null => {
    const parsedQuotedAmount = numberValue(quotedAmount);
    const parsedBillableRate = numberValue(billableRate);
    const parsedCostRate = numberValue(costRate);
    const effectiveOverrides = resolveHourOverrideValues({
      billableHoursOverride: nextBillableOverride,
      costHoursOverride: nextCostOverride,
    }, options);
    const effectiveBillableOverride = effectiveOverrides.billableHoursOverride;
    const effectiveCostOverride = effectiveOverrides.costHoursOverride;
    if (!options && billableOverride.trim() && nextBillableOverride == null) {
      setError('Billable hours override must be a valid number or left empty.');
      return null;
    }
    if (!options && costOverride.trim() && nextCostOverride == null) {
      setError('Cost hours override must be a valid number or left empty.');
      return null;
    }
    if (pricingMode === 'quoted' && (parsedQuotedAmount == null || parsedQuotedAmount < 0)) {
      setError('Enter a valid quoted amount of zero or more.');
      return null;
    }
    if (parsedBillableRate == null || parsedBillableRate < 0 || parsedCostRate == null || parsedCostRate < 0) {
      setError('Billable and cost rates must be valid amounts of zero or more.');
      return null;
    }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
      setError('Currency must be a three-letter code such as AUD.');
      return null;
    }
    if ((effectiveBillableOverride != null && effectiveBillableOverride < 0) || (effectiveCostOverride != null && effectiveCostOverride < 0)) {
      setError('Hour overrides cannot be negative.');
      return null;
    }
    const effectiveChanged = effectiveBillableOverride !== summary.time.billableHoursOverride
      || effectiveCostOverride !== summary.time.costHoursOverride;
    const fullClear = effectiveBillableOverride == null && effectiveCostOverride == null;
    const reason = overrideReason.trim();
    if (effectiveChanged && !fullClear && !overrideReason.trim()) {
      setError('Add a fresh reason for the hour override so the adjustment is auditable.');
      return null;
    }
    return {
      pricingMode,
      quotedAmount: pricingMode === 'quoted' ? parsedQuotedAmount : null,
      currency: currency.trim().toUpperCase(),
      notes: notes.trim() || null,
      billableHoursOverride: effectiveBillableOverride,
      costHoursOverride: effectiveCostOverride,
      billableRate: parsedBillableRate,
      costRate: parsedCostRate,
      ...(shouldAttachHourOverrideReason({
        overrideSource: summary.time.overrideSource,
        effectiveChanged,
        fullClear,
        reason,
      })
        ? { overrideReason: reason }
        : {}),
      billingName: billingName.trim() || null,
      billingAddress: billingAddress.trim() || null,
      billingEmail: billingEmail.trim() || null,
      billingReference: billingReference.trim() || null,
    };
  };

  async function submit() {
    setError(null);
    const payload = basePayload();
    if (!payload) return;
    try {
      await save.mutateAsync(payload);
      setOverrideReason('');
      toast.success('Commercial settings saved.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  async function clearOverrides() {
    setError(null);
    const payload = basePayload({ billableHoursOverride: null, costHoursOverride: null });
    if (!payload) return;
    try {
      await save.mutateAsync({
        ...payload,
        overrideReason: null,
      });
      setBillableOverride('');
      setCostOverride('');
      setOverrideReason('');
      toast.success('Hour overrides cleared. Recorded app time is effective again.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  const hasOverride = summary.time.billableHoursOverride != null || summary.time.costHoursOverride != null;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="finance-time-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="finance-time-heading" className="font-extrabold text-[var(--text)]">Time, rates & billing</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Recorded app time stays visible even when an admin applies a billing override.</p>
        </div>
        {summary.time.needsHoursReview ? (
          <span className="rounded-full bg-[var(--amber-soft)] px-3 py-1 text-xs font-extrabold text-[var(--amber)]">
            Needs hours review
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HourMetric
          label="Recorded active hours"
          value={summary.time.actualHours}
          badge={summary.time.actualHours <= 0 ? 'No app time' : 'Recorded'}
          tone={summary.time.actualHours <= 0 ? 'warning' : 'success'}
          hint="Foreground app time recorded for this job; background time is excluded."
        />
        <HourMetric
          label="Effective billable hours"
          value={summary.time.billableHours}
          source={summary.time.billableHoursSource}
          legacy={summary.time.overrideSource === 'legacy_estimate'}
          hint="Hours used to calculate labour revenue."
        />
        <HourMetric
          label="Effective cost hours"
          value={summary.time.costHours}
          source={summary.time.costHoursSource}
          legacy={summary.time.overrideSource === 'legacy_estimate'}
          hint="Hours used to calculate labour cost."
        />
        <HourMetric
          label="Scheduled hours"
          value={summary.time.scheduledHours}
          badge={summary.time.hoursVariance === 0 ? 'On plan' : `${summary.time.hoursVariance > 0 ? '+' : ''}${summary.time.hoursVariance.toFixed(2)}h variance`}
          tone={summary.time.hoursVariance > 0 ? 'warning' : 'neutral'}
          hint="Planned Scheduler duration for comparison only."
        />
      </div>

      <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${
        summary.time.commercialHoursVariance < 0
          ? 'bg-[var(--amber-soft)] text-[var(--amber)]'
          : 'bg-[var(--surface2)] text-[var(--text-sub)]'
      }`}>
        Billable vs cost hours: {summary.time.commercialHoursVariance > 0 ? '+' : ''}{summary.time.commercialHoursVariance.toFixed(2)}h.
        {summary.time.commercialHoursVariance < 0 ? ' Cost hours currently exceed customer-billable hours.' : ''}
      </p>

      {summary.time.actors.length > 0 ? (
        <details className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5">
          <summary className="cursor-pointer text-sm font-bold text-[var(--text)]">Recorded time by person</summary>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {summary.time.actors.map((actor) => (
              <div key={actor.userId} className="flex justify-between gap-3 text-sm">
                <dt className="truncate text-[var(--text-sub)]">{actor.displayName || 'Unknown user'}</dt>
                <dd className="font-extrabold text-[var(--text)]">{actor.hours.toFixed(2)}h</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {hasOverride && summary.time.overrideReason ? (
        <div className="mt-3 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-3 py-2.5 text-sm text-[var(--text)]">
          <span className="font-extrabold">Override audit:</span> {summary.time.overrideReason}
          <span className="mt-1 block text-xs text-[var(--text-sub)]">
            {summary.time.overriddenBy?.displayName || 'Admin'}
            {summary.time.overriddenAt ? ` · ${displayDate(summary.time.overriddenAt)}` : ''}
          </span>
        </div>
      ) : null}

      <div className="mt-5 grid gap-x-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-extrabold text-[var(--text)]">Pricing & rates</h3>
          <FieldLabel htmlFor="finance-pricing-mode">Pricing mode</FieldLabel>
          <Select id="finance-pricing-mode" value={pricingMode} onChange={(event) => setPricingMode(event.target.value as FinancePricingMode)}>
            <option value="quoted">Quoted</option>
            <option value="charge_up">Charge-up</option>
          </Select>
          {pricingMode === 'quoted' ? (
            <>
              <FieldLabel htmlFor="finance-quoted-amount">Quoted amount (ex GST)</FieldLabel>
              <Input id="finance-quoted-amount" type="number" min="0" step="0.01" inputMode="decimal" value={quotedAmount} onChange={(event) => setQuotedAmount(event.target.value)} />
            </>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="finance-billable-rate">Billable rate / hour</FieldLabel>
              <Input id="finance-billable-rate" type="number" min="0" step="0.01" inputMode="decimal" value={billableRate} onChange={(event) => setBillableRate(event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor="finance-cost-rate">Cost rate / hour</FieldLabel>
              <Input id="finance-cost-rate" type="number" min="0" step="0.01" inputMode="decimal" value={costRate} onChange={(event) => setCostRate(event.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="finance-billable-hours">Billable hours override</FieldLabel>
              <Input id="finance-billable-hours" type="number" min="0" step="0.01" inputMode="decimal" value={billableOverride} onChange={(event) => setBillableOverride(event.target.value)} placeholder="Use recorded" />
            </div>
            <div>
              <FieldLabel htmlFor="finance-cost-hours">Cost hours override</FieldLabel>
              <Input id="finance-cost-hours" type="number" min="0" step="0.01" inputMode="decimal" value={costOverride} onChange={(event) => setCostOverride(event.target.value)} placeholder="Use recorded" />
            </div>
          </div>
          <FieldLabel htmlFor="finance-override-reason">Override reason</FieldLabel>
          <Input id="finance-override-reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Required for every new override change" />
          <FieldHint>Leave hour override fields empty to use active app time. Existing audited reasons remain unchanged by unrelated edits.</FieldHint>
          {summary.time.overrideSource === 'legacy_estimate' ? (
            <p className="mt-2 rounded-lg bg-[var(--amber-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--amber)]">
              To accept the migrated estimate unchanged, enter a fresh confirmation reason and save. This replaces legacy provenance with an admin audit.
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="mt-6 text-sm font-extrabold text-[var(--text)] lg:mt-0">Billing details</h3>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="finance-bill-name">Bill-to name</FieldLabel>
              <Input id="finance-bill-name" value={billingName} onChange={(event) => setBillingName(event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor="finance-bill-email">Bill-to email</FieldLabel>
              <Input id="finance-bill-email" type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} />
            </div>
          </div>
          <FieldLabel htmlFor="finance-bill-address">Bill-to address</FieldLabel>
          <Textarea id="finance-bill-address" rows={3} value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} />
          <FieldLabel htmlFor="finance-bill-reference">PO / customer reference</FieldLabel>
          <Input id="finance-bill-reference" value={billingReference} onChange={(event) => setBillingReference(event.target.value)} />
          <FieldHint>These details seed new drafts. A draft can be corrected until its header is frozen on issue.</FieldHint>
          <FieldLabel htmlFor="finance-currency">Currency</FieldLabel>
          <Input id="finance-currency" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          <FieldLabel htmlFor="finance-notes">Commercial notes</FieldLabel>
          <Textarea id="finance-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {hasOverride ? (
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => void clearOverrides()}>
            Clear overrides
          </Button>
        ) : null}
        <Button type="button" disabled={save.isPending} onClick={() => void submit()}>
          {save.isPending
            ? 'Saving…'
            : summary.time.overrideSource === 'legacy_estimate' && overrideReason.trim()
              ? 'Confirm hours & save'
              : 'Save commercial settings'}
        </Button>
      </div>
    </section>
  );
}

function HourMetric({
  label,
  value,
  source,
  badge,
  tone = 'neutral',
  legacy = false,
  hint,
}: {
  label: string;
  value: number;
  source?: 'actual' | 'override';
  badge?: string;
  tone?: 'success' | 'warning' | 'neutral';
  legacy?: boolean;
  hint: string;
}) {
  const badgeClass = tone === 'warning'
    ? 'bg-[var(--amber-soft)] text-[var(--amber)]'
    : tone === 'success'
      ? 'bg-[var(--green-soft)] text-[var(--green)]'
      : 'bg-[var(--surface2)] text-[var(--text-sub)]';
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-[var(--text-sub)]">{label}</p>
        {legacy ? (
          <span className="rounded-full bg-[var(--amber-soft)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--amber)]">Legacy estimate</span>
        ) : source ? <ProvenanceBadge source={source} /> : badge ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${badgeClass}`}>{badge}</span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--text)]">{value.toFixed(2)}h</p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{hint}</p>
    </div>
  );
}
