'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { useUpsertFinanceHeader } from '@/modules/installhub/finance/hooks';
import type { FinanceHeader, PricingMode } from '@/modules/installhub/finance/types';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';

export function FinanceHeaderForm({
  installationId,
  header,
  canEdit,
}: {
  installationId: string;
  header: FinanceHeader;
  canEdit: boolean;
}) {
  const upsert = useUpsertFinanceHeader(installationId);
  const [pricingMode, setPricingMode] = useState<PricingMode>(header.pricingMode);
  const [pricedAmount, setPricedAmount] = useState(
    header.pricedAmount == null ? '' : String(header.pricedAmount),
  );
  const [notes, setNotes] = useState(header.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-extrabold text-[var(--text)]">Job pricing</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--text-sub)]">Mode</dt>
            <dd className="font-bold capitalize text-[var(--text)]">{header.pricingMode.replace('_', '-')}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-sub)]">Priced amount</dt>
            <dd className="font-bold text-[var(--text)]">
              {header.pricedAmount == null ? '—' : money(header.pricedAmount, header.currency)}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        void upsert
          .mutateAsync({
            pricingMode,
            pricedAmount: pricedAmount.trim() === '' ? null : Number(pricedAmount),
            notes: notes.trim() || null,
            currency: header.currency,
          })
          .catch((err) => setError(installHubConnectionErrorMessage(err)));
      }}
    >
      <h3 className="text-sm font-extrabold text-[var(--text)]">Job pricing</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Pricing mode</FieldLabel>
          <Select
            value={pricingMode}
            onChange={(e) => setPricingMode(e.target.value as PricingMode)}
          >
            <option value="charge_up">Charge-up</option>
            <option value="quoted">Quoted</option>
          </Select>
        </div>
        <div>
          <FieldLabel>Billable / priced amount ({header.currency})</FieldLabel>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={pricedAmount}
            onChange={(e) => setPricedAmount(e.target.value)}
            placeholder={pricingMode === 'quoted' ? 'Quote total' : 'Optional estimate'}
          />
        </div>
      </div>
      <div>
        <FieldLabel>Notes</FieldLabel>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      {error ? <p className="text-sm font-semibold text-[var(--red)]">{error}</p> : null}
      <Button type="submit" disabled={upsert.isPending}>
        {upsert.isPending ? 'Saving…' : 'Save pricing'}
      </Button>
    </form>
  );
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
}
