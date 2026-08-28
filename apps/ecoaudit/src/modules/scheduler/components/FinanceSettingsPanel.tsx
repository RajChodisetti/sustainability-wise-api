'use client';

import { useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { FieldLabel, Input } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { useUpdateSchedulerActorBillingRateOverride } from '@/modules/scheduler/hooks/useScheduler';
import type { SchedulerFinancialSummary } from '@/modules/scheduler/types/domain';

type FinanceActor = SchedulerFinancialSummary['time']['actors'][number];

function numberValue(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatRate(value: number | null, currency: string): string {
  if (value === null) return 'Not set';
  return `${new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)} / hour`;
}

function billingRateSourceLabel(source: FinanceActor['billingRateSource']): string {
  if (source === 'job_override') return 'Job override';
  if (source === 'global_default') return 'Global default';
  return 'Missing rate';
}

export function FinanceSettingsPanel({ financeId, summary }: {
  financeId: string;
  summary: SchedulerFinancialSummary;
}) {
  const [ratesOpen, setRatesOpen] = useState(false);
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="employee-rates-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="employee-rates-heading" className="font-extrabold text-[var(--text)]">Job employee billing rates</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Override a user&apos;s billing rate for this job only. Canonical defaults remain managed in Finance → Users.</p>
        </div>
        <Button type="button" variant="secondary" aria-expanded={ratesOpen} aria-controls="job-employee-rate-list" onClick={() => setRatesOpen((open) => !open)}>
          {ratesOpen ? 'Hide job rates' : 'Edit job rates'}
        </Button>
      </div>
      {ratesOpen ? (
        <div id="job-employee-rate-list" className="mt-4">
          {summary.time.actors.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {summary.time.actors.map((actor) => (
                <JobBillingRateOverrideEditor
                  key={`${actor.userId}:${actor.billingRateOverride ?? 'default'}:${actor.effectiveBillingRate ?? 'missing'}`}
                  financeId={financeId}
                  actor={actor}
                  currency={summary.currency}
                />
              ))}
            </div>
          ) : <p className="rounded-lg bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--text-sub)]">No employee is linked to this job yet.</p>}
        </div>
      ) : null}
    </section>
  );
}

function JobBillingRateOverrideEditor({ financeId, actor, currency }: {
  financeId: string;
  actor: FinanceActor;
  currency: string;
}) {
  const toast = useToast();
  const update = useUpdateSchedulerActorBillingRateOverride();
  const [value, setValue] = useState(actor.billingRateOverride?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const displayName = actor.displayName || actor.userId;
  const inputId = `job-billing-rate-${financeId}-${actor.userId}`.replace(/[^a-zA-Z0-9_-]/g, '-');

  async function save(next: number | null) {
    if (!actor.billingRateEditable) {
      setError('Link this app user to a portal identity before setting a job rate.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({
        financeId,
        globalUserId: actor.userId,
        billingRateOverride: next,
      });
      toast.success(next === null
        ? `${displayName} now uses the global default for this job.`
        : `Job billing rate saved for ${displayName}.`);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  function saveOverride() {
    const next = numberValue(value);
    if (next === undefined) {
      setError('Enter a job billing rate of zero or more, or choose Use default.');
      return;
    }
    void save(next);
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
      <p className="text-sm font-extrabold text-[var(--text)]">{displayName}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-[var(--surface)] p-2.5">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-sub)]">Global default</dt>
          <dd className="mt-1 font-extrabold text-[var(--text)]">{formatRate(actor.defaultBillingRate, currency)}</dd>
        </div>
        <div className="rounded-lg bg-[var(--surface)] p-2.5">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-sub)]">Effective for this job</dt>
          <dd className="mt-1 font-extrabold text-[var(--text)]">{formatRate(actor.effectiveBillingRate, currency)}</dd>
          <dd className="mt-0.5 text-xs text-[var(--text-sub)]">{billingRateSourceLabel(actor.billingRateSource)}</dd>
        </div>
      </dl>
      <div className="mt-3">
        <FieldLabel htmlFor={inputId}>Job override · {currency}/hour</FieldLabel>
        <Input
          id={inputId}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value}
          disabled={update.isPending || !actor.billingRateEditable}
          onChange={(event) => setValue(event.target.value)}
          placeholder={actor.defaultBillingRate === null ? 'Enter job rate' : `Default ${actor.defaultBillingRate.toFixed(2)}`}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={update.isPending || !actor.billingRateEditable} onClick={saveOverride}>
          {update.isPending ? 'Saving…' : 'Save job rate'}
        </Button>
        <Button type="button" variant="ghost" disabled={update.isPending || !actor.billingRateEditable || actor.billingRateOverride === null} onClick={() => void save(null)}>
          Use default
        </Button>
      </div>
      <p className="mt-2 text-xs text-[var(--text-sub)]">
        {actor.billingRateEditable
          ? actor.billingRateOverride === null
            ? 'This job follows the user’s global default.'
            : 'This job override takes precedence over later changes to the global default.'
          : 'Link this app user to a portal identity before setting a job rate.'}
      </p>
      {error ? <p className="mt-2 text-xs font-semibold text-[var(--red)]">{error}</p> : null}
    </div>
  );
}
