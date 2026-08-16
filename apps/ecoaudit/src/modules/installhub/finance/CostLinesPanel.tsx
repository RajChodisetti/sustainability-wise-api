'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  useCreateCostLine,
  useDeleteCostLine,
  useUpdateCostLine,
} from '@/modules/installhub/finance/hooks';
import type { CostCategory, CostLine } from '@/modules/installhub/finance/types';

export function CostLinesPanel({
  installationId,
  lines,
  currency,
  canEdit,
}: {
  installationId: string;
  lines: CostLine[];
  currency: string;
  canEdit: boolean;
}) {
  const create = useCreateCostLine(installationId);
  const update = useUpdateCostLine(installationId);
  const remove = useDeleteCostLine(installationId);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<CostCategory>('labour');
  const [description, setDescription] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [hours, setHours] = useState('');

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <h3 className="text-sm font-extrabold text-[var(--text)]">Cost lines</h3>
        <p className="mt-1 text-xs text-[var(--text-sub)]">
          Log labour, materials, and other costs. Toggle invoiced as you bill outside the portal.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-sub)]">
              <th className="py-2 pr-2 font-bold">Category</th>
              <th className="py-2 pr-2 font-bold">Description</th>
              <th className="py-2 pr-2 font-bold">Cost</th>
              <th className="py-2 pr-2 font-bold">Sell</th>
              <th className="py-2 pr-2 font-bold">Hrs</th>
              <th className="py-2 pr-2 font-bold">Flags</th>
              {canEdit ? <th className="py-2 font-bold" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-[var(--border)]/70">
                <td className="py-2 pr-2 capitalize">
                  {line.category}
                  {line.source === 'auto_labour' ? (
                    <span className="ml-1 rounded-full bg-[var(--primary-soft)] px-1.5 py-0.5 text-[9px] font-extrabold text-[var(--primary)]">
                      Auto
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-2 font-semibold text-[var(--text)]">{line.description}</td>
                <td className="py-2 pr-2">{money(line.costAmount, currency)}</td>
                <td className="py-2 pr-2">
                  {line.sellAmount == null ? '—' : money(line.sellAmount, currency)}
                </td>
                <td className="py-2 pr-2">{line.hours ?? '—'}</td>
                <td className="py-2 pr-2">
                  <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                    <span className={line.billable ? 'text-[var(--primary)]' : 'text-[var(--muted)]'}>
                      {line.billable ? 'Billable' : 'Non-billable'}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-[var(--text-sub)] underline"
                        onClick={() => {
                          setError(null);
                          void update
                            .mutateAsync({
                              lineId: line.id,
                              input: { invoiced: !line.invoiced },
                            })
                            .catch((err) => setError(installHubConnectionErrorMessage(err)));
                        }}
                      >
                        {line.invoiced ? 'Invoiced' : 'Mark invoiced'}
                      </button>
                    ) : (
                      <span>{line.invoiced ? 'Invoiced' : 'Uninvoiced'}</span>
                    )}
                  </div>
                </td>
                {canEdit ? (
                  <td className="py-2 text-right">
                    {line.source === 'auto_labour' ? (
                      <span className="text-[10px] text-[var(--muted)]">System</span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-bold text-[var(--red)]"
                        onClick={() => {
                          setError(null);
                          void remove
                            .mutateAsync(line.id)
                            .catch((err) => setError(installHubConnectionErrorMessage(err)));
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="py-6 text-center text-[var(--text-sub)]">
                  No costs logged yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <form
          className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void create
              .mutateAsync({
                category,
                description: description.trim(),
                costAmount: Number(costAmount),
                sellAmount: sellAmount.trim() === '' ? null : Number(sellAmount),
                hours: hours.trim() === '' ? null : Number(hours),
                billable: true,
                invoiced: false,
              })
              .then(() => {
                setDescription('');
                setCostAmount('');
                setSellAmount('');
                setHours('');
              })
              .catch((err) => setError(installHubConnectionErrorMessage(err)));
          }}
        >
          <div>
            <FieldLabel>Category</FieldLabel>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as CostCategory)}
            >
              <option value="labour">Labour</option>
              <option value="material">Material</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="lg:col-span-2">
            <FieldLabel>Description</FieldLabel>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="Site labour / cable / …"
            />
          </div>
          <div>
            <FieldLabel>Cost</FieldLabel>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={costAmount}
              onChange={(e) => setCostAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <FieldLabel>Sell</FieldLabel>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <FieldLabel>Hours</FieldLabel>
            <Input
              type="number"
              step="0.25"
              min="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex items-end lg:col-span-6">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : '+ Add cost line'}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <p className="text-sm font-semibold text-[var(--red)]">{error}</p> : null}
    </div>
  );
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
}
