'use client';

import { useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { FieldLabel, Input } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { useUpdatePortalUserBillingRate } from '@/modules/scheduler/hooks/useScheduler';
import type { SchedulerFinancialSummary } from '@/modules/scheduler/types/domain';

function numberValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function FinanceSettingsPanel({ summary }: {
  financeId: string;
  summary: SchedulerFinancialSummary;
}) {
  const [ratesOpen, setRatesOpen] = useState(false);
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="employee-rates-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="employee-rates-heading" className="font-extrabold text-[var(--text)]">Employee hourly rates</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Set each employee rate once and update it whenever needed.</p>
        </div>
        <Button type="button" variant="secondary" aria-expanded={ratesOpen} aria-controls="employee-rate-list" onClick={() => setRatesOpen((open) => !open)}>
          {ratesOpen ? 'Hide employee rates' : 'Fix employee rates'}
        </Button>
      </div>
      {ratesOpen ? (
        <div id="employee-rate-list" className="mt-4">
          {summary.time.actors.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {summary.time.actors.map((actor) => (
                <BillingRateEditor key={actor.userId} userId={actor.userId} displayName={actor.displayName || actor.userId} billingRate={actor.billingRate} billingRateEditable={actor.billingRateEditable} />
              ))}
            </div>
          ) : <p className="rounded-lg bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--text-sub)]">No employee is linked to this job yet.</p>}
        </div>
      ) : null}
    </section>
  );
}

function BillingRateEditor({ userId, displayName, billingRate, billingRateEditable }: {
  userId: string;
  displayName: string;
  billingRate: number | null;
  billingRateEditable: boolean;
}) {
  const toast = useToast();
  const update = useUpdatePortalUserBillingRate();
  const [value, setValue] = useState(billingRate?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  async function saveRate() {
    if (!billingRateEditable) {
      setError('Link this app user to a portal identity before setting a rate.');
      return;
    }
    const next = numberValue(value);
    if (next == null || next < 0) {
      setError('Enter an hourly rate of zero or more.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ globalUserId: userId, billingRate: next });
      toast.success(`Hourly rate saved for ${displayName}.`);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
      <p className="text-sm font-extrabold text-[var(--text)]">{displayName}</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={`billing-rate-${userId}`}>Hourly rate</FieldLabel>
          <Input id={`billing-rate-${userId}`} type="number" min="0" step="0.01" inputMode="decimal" value={value} disabled={!billingRateEditable} onChange={(event) => setValue(event.target.value)} placeholder="0.00" />
        </div>
        <Button type="button" variant="secondary" disabled={update.isPending || !billingRateEditable} onClick={() => void saveRate()}>{update.isPending ? 'Saving…' : 'Save rate'}</Button>
      </div>
      {error ? <p className="mt-2 text-xs font-semibold text-[var(--red)]">{error}</p> : null}
    </div>
  );
}
