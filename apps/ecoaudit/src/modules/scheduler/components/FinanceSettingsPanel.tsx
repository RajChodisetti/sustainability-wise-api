'use client';

import { useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import {
  useUpdatePortalUserBillingRate,
  useUpdateSchedulerFinance,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  isWholeBillingHoursInput,
  wholeBillingHours,
} from '@/modules/scheduler/lib/billingHours';
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

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
}

function ProvenanceBadge({ source }: {
  source: 'default_zero' | 'override';
}) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
      source === 'override'
        ? 'bg-[var(--amber-soft)] text-[var(--amber)]'
        : 'bg-[var(--surface2)] text-[var(--text-sub)]'
    }`}>
      {source === 'override' ? 'Admin value' : 'Starts at zero'}
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
  const [billableHours, setBillableHours] = useState(
    wholeBillingHours(summary.time.billableHours).toString(),
  );
  const [costHours, setCostHours] = useState(summary.time.costHours.toString());
  const [costRate, setCostRate] = useState(summary.time.costRate.toString());
  const [overrideReason, setOverrideReason] = useState('');
  const [billingName, setBillingName] = useState(summary.billing.name ?? '');
  const [billingAddress, setBillingAddress] = useState(summary.billing.address ?? '');
  const [billingEmail, setBillingEmail] = useState(summary.billing.email ?? '');
  const [billingAbn, setBillingAbn] = useState(summary.billing.abn ?? '');
  const [billingReference, setBillingReference] = useState(summary.billing.reference ?? '');
  const [error, setError] = useState<string | null>(null);

  function buildPayload(): UpdateSchedulerFinanceInput | null {
    const nextQuotedAmount = numberValue(quotedAmount);
    const nextBillableHours = numberValue(billableHours);
    const nextCostHours = numberValue(costHours);
    const nextCostRate = numberValue(costRate);
    if (pricingMode === 'quoted' && (nextQuotedAmount == null || nextQuotedAmount < 0)) {
      setError('Enter a valid quoted amount of zero or more.');
      return null;
    }
    if (nextBillableHours == null || !Number.isSafeInteger(nextBillableHours) || nextBillableHours < 0) {
      setError('Billing hours must be a whole number of zero or more.');
      return null;
    }
    if (nextCostHours == null || nextCostHours < 0) {
      setError('Cost hours must be a valid number of zero or more.');
      return null;
    }
    if (nextCostRate == null || nextCostRate < 0) {
      setError('Cost rate must be a valid amount of zero or more.');
      return null;
    }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
      setError('Currency must be a three-letter code such as AUD.');
      return null;
    }
    const hoursChanged = nextBillableHours !== summary.time.billableHours
      || nextCostHours !== summary.time.costHours;
    if (hoursChanged && !overrideReason.trim()) {
      setError('Add a reason for the edited hours so the change remains auditable.');
      return null;
    }
    const payload: UpdateSchedulerFinanceInput = {};
    if (pricingMode !== summary.pricing.mode) payload.pricingMode = pricingMode;
    const effectiveQuote = pricingMode === 'quoted' ? nextQuotedAmount : null;
    if (effectiveQuote !== summary.pricing.quotedAmount) payload.quotedAmount = effectiveQuote;
    const normalizedCurrency = currency.trim().toUpperCase();
    if (normalizedCurrency !== summary.currency) payload.currency = normalizedCurrency;
    if ((notes.trim() || null) !== summary.pricing.notes) payload.notes = notes.trim() || null;
    if (nextCostRate !== summary.time.costRate) payload.costRate = nextCostRate;
    if (nextBillableHours !== summary.time.billableHours) {
      payload.billableHoursOverride = nextBillableHours;
    }
    if (nextCostHours !== summary.time.costHours) payload.costHoursOverride = nextCostHours;
    if (hoursChanged) payload.overrideReason = overrideReason.trim();
    if ((billingName.trim() || null) !== summary.billing.name) {
      payload.billingName = billingName.trim() || null;
    }
    if ((billingAddress.trim() || null) !== summary.billing.address) {
      payload.billingAddress = billingAddress.trim() || null;
    }
    if ((billingEmail.trim() || null) !== summary.billing.email) {
      payload.billingEmail = billingEmail.trim() || null;
    }
    if ((billingAbn.trim() || null) !== summary.billing.abn) {
      payload.billingAbn = billingAbn.trim() || null;
    }
    if ((billingReference.trim() || null) !== summary.billing.reference) {
      payload.billingReference = billingReference.trim() || null;
    }
    return payload;
  }

  async function submit() {
    setError(null);
    const payload = buildPayload();
    if (!payload) return;
    if (Object.keys(payload).length === 0) {
      toast.success('Commercial settings are already up to date.');
      return;
    }
    try {
      await save.mutateAsync(payload);
      setOverrideReason('');
      toast.success('Commercial settings saved. Existing invoices were not changed.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  const hasOverride = summary.time.billableHoursOverride != null
    || summary.time.costHoursOverride != null;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="finance-time-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="finance-time-heading" className="font-extrabold text-[var(--text)]">Internal time & billing setup</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--text-sub)]">
            App time is shown as evidence only. Commercial hours start at zero and change only when an admin saves them.
          </p>
        </div>
        {summary.time.needsHoursReview ? (
          <span className="rounded-full bg-[var(--amber-soft)] px-3 py-1 text-xs font-extrabold text-[var(--amber)]">
            Setup required
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HourMetric
          label="App-active hours"
          value={summary.time.actualHours}
          badge={summary.time.actualHours <= 0 ? 'No app time' : 'Suggestion'}
          hint="Reported as active by the source app. Never assumed for billing."
        />
        <HourMetric
          label="Billing hours"
          value={summary.time.billableHours}
          source={summary.time.billableHoursSource}
          hint="Editable internal hours used for the labour suggestion."
          whole
        />
        <HourMetric
          label="Cost hours"
          value={summary.time.costHours}
          source={summary.time.costHoursSource}
          hint="Editable internal hours used for labour cost."
        />
        <HourMetric
          label="Scheduled hours"
          value={summary.time.scheduledHours}
          badge="Comparison only"
          hint="Planned duration is never copied into billing."
        />
      </div>

      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3" aria-labelledby="person-rates-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="person-rates-heading" className="text-sm font-extrabold text-[var(--text)]">Fixed billing rate by person</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
              Rates belong to users, not jobs. They are used only for internal calculations and an editable labour suggestion.
            </p>
          </div>
          <span className="text-sm font-extrabold text-[var(--text)]">
            Internal labour: {money(summary.time.labourRevenue, summary.currency)}
          </span>
        </div>
        {summary.time.actors.length > 0 ? (
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {summary.time.actors.map((actor) => (
              <BillingRateEditor
                key={actor.userId}
                userId={actor.userId}
                displayName={actor.displayName || actor.userId}
                activeHours={actor.hours}
                billingRate={actor.billingRate}
                billingRateEditable={actor.billingRateEditable}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-[var(--amber-soft)] px-3 py-2 text-xs font-semibold text-[var(--amber)]">
            No billing user is linked to this job yet. Assign or record a user before calculating labour.
          </p>
        )}
      </section>

      <div className="mt-5 grid gap-x-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-extrabold text-[var(--text)]">Internal calculation</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="finance-billable-hours">Billing hours</FieldLabel>
              <Input
                id="finance-billable-hours"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={billableHours}
                aria-describedby="finance-billable-hours-hint"
                onChange={(event) => {
                  if (isWholeBillingHoursInput(event.target.value)) {
                    setBillableHours(event.target.value);
                  }
                }}
              />
              <FieldHint id="finance-billable-hours-hint">
                Whole hours only. Type a non-negative whole number. App time is rounded to the nearest whole hour when copied here.
              </FieldHint>
            </div>
            <div>
              <FieldLabel htmlFor="finance-cost-hours">Cost hours</FieldLabel>
              <Input id="finance-cost-hours" type="number" min="0" step="0.01" inputMode="decimal" value={costHours} onChange={(event) => setCostHours(event.target.value)} />
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setBillableHours(wholeBillingHours(summary.time.actualHours).toString());
              setCostHours(summary.time.actualHours.toString());
            }}
          >
            Use app-recorded hours as a starting point
          </Button>
          <FieldLabel htmlFor="finance-override-reason">Reason for changing hours</FieldLabel>
          <Input id="finance-override-reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Required when hours change" />
          <FieldHint>Invoice PDFs hide these hours and user rates unless you explicitly enable quantity and rate on an invoice line.</FieldHint>

          <FieldLabel htmlFor="finance-pricing-mode">Suggestion basis</FieldLabel>
          <Select id="finance-pricing-mode" value={pricingMode} onChange={(event) => setPricingMode(event.target.value as FinancePricingMode)}>
            <option value="charge_up">User hours and rates</option>
            <option value="quoted">Quoted amount</option>
          </Select>
          {pricingMode === 'quoted' ? (
            <>
              <FieldLabel htmlFor="finance-quoted-amount">Quoted amount (ex GST)</FieldLabel>
              <Input id="finance-quoted-amount" type="number" min="0" step="0.01" inputMode="decimal" value={quotedAmount} onChange={(event) => setQuotedAmount(event.target.value)} />
            </>
          ) : null}
          <FieldLabel htmlFor="finance-cost-rate">Internal cost rate / hour</FieldLabel>
          <Input id="finance-cost-rate" type="number" min="0" step="0.01" inputMode="decimal" value={costRate} onChange={(event) => setCostRate(event.target.value)} />
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
            <div>
              <FieldLabel htmlFor="finance-bill-abn">Recipient ABN</FieldLabel>
              <Input id="finance-bill-abn" inputMode="numeric" value={billingAbn} onChange={(event) => setBillingAbn(event.target.value)} />
            </div>
          </div>
          <FieldLabel htmlFor="finance-bill-address">Bill-to address</FieldLabel>
          <Textarea id="finance-bill-address" rows={3} value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} />
          <FieldLabel htmlFor="finance-bill-reference">PO / customer reference</FieldLabel>
          <Input id="finance-bill-reference" value={billingReference} onChange={(event) => setBillingReference(event.target.value)} />
          <FieldHint>These details seed new invoice drafts. Draft lines and amounts remain editable until issue.</FieldHint>
          <FieldLabel htmlFor="finance-currency">Currency</FieldLabel>
          <Input id="finance-currency" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          <FieldLabel htmlFor="finance-notes">Internal commercial notes</FieldLabel>
          <Textarea id="finance-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      {hasOverride && summary.time.overrideReason ? (
        <p className="mt-3 text-xs text-[var(--text-sub)]">
          Last hour edit: {summary.time.overrideReason} · {summary.time.overriddenBy?.displayName || 'Admin'}
          {summary.time.overriddenAt ? ` · ${displayDate(summary.time.overriddenAt)}` : ''}
        </p>
      ) : null}
      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      <div className="mt-5 flex justify-end">
        <Button type="button" disabled={save.isPending} onClick={() => void submit()}>
          {save.isPending ? 'Saving…' : 'Save internal settings'}
        </Button>
      </div>
    </section>
  );
}

function BillingRateEditor({
  userId,
  displayName,
  activeHours,
  billingRate,
  billingRateEditable,
}: {
  userId: string;
  displayName: string;
  activeHours: number;
  billingRate: number | null;
  billingRateEditable: boolean;
}) {
  const toast = useToast();
  const update = useUpdatePortalUserBillingRate();
  const [value, setValue] = useState(billingRate?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);

  async function saveRate() {
    if (!billingRateEditable) {
      setError('Ask an admin to link this app user to a canonical portal identity first.');
      return;
    }
    const next = numberValue(value);
    if (next == null || next < 0) {
      setError('Ask an admin to enter a rate of zero or more.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ globalUserId: userId, billingRate: next });
      toast.success(`Billing rate saved for ${displayName}.`);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  return (
    <div className={`rounded-lg border p-3 ${billingRate == null ? 'border-[var(--amber)]/40 bg-[var(--amber-soft)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold text-[var(--text)]">{displayName}</p>
          <p className="text-xs leading-5 text-[var(--text-sub)]">
            {activeHours.toFixed(2)}h app-active
          </p>
        </div>
        {billingRate == null ? <span className="text-xs font-extrabold text-[var(--amber)]">Admin rate required</span> : null}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={`billing-rate-${userId}`}>Billing rate / hour</FieldLabel>
          <Input id={`billing-rate-${userId}`} type="number" min="0" step="0.01" inputMode="decimal" value={value} disabled={!billingRateEditable} onChange={(event) => setValue(event.target.value)} placeholder={billingRateEditable ? 'Ask admin to set rate' : 'Canonical user link required'} />
        </div>
        <Button type="button" variant="secondary" disabled={update.isPending || !billingRateEditable} onClick={() => void saveRate()}>
          {update.isPending ? 'Saving…' : 'Save rate'}
        </Button>
      </div>
      {!billingRateEditable ? <p className="mt-2 text-xs font-semibold text-[var(--amber)]">Ask an admin to link this app user before assigning a fixed billing rate.</p> : null}
      {error ? <p className="mt-2 text-xs font-semibold text-[var(--red)]">{error}</p> : null}
    </div>
  );
}

function HourMetric({
  label,
  value,
  source,
  badge,
  hint,
  whole = false,
}: {
  label: string;
  value: number;
  source?: 'default_zero' | 'override';
  badge?: string;
  hint: string;
  whole?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-[var(--text-sub)]">{label}</p>
        {source ? <ProvenanceBadge source={source} /> : badge ? (
          <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--text-sub)]">{badge}</span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--text)]">{value.toFixed(whole ? 0 : 2)}h</p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{hint}</p>
    </div>
  );
}
