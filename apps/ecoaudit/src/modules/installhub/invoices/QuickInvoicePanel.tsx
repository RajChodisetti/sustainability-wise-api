'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import type { CostLine } from '@/modules/installhub/finance/types';
import { useQuickCreateInvoice } from '@/modules/installhub/invoices/hooks';

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function effectiveSell(line: CostLine): number {
  if (!line.billable) return 0;
  if (line.sellAmount != null) return line.sellAmount;
  return line.costAmount;
}

type Props = {
  installationId: string;
  currency: string;
  lines: CostLine[];
  canEdit: boolean;
};

export function QuickInvoicePanel({ installationId, currency, lines, canEdit }: Props) {
  const router = useRouter();
  const create = useQuickCreateInvoice(installationId);
  const eligible = useMemo(
    () => lines.filter((l) => l.billable && !l.invoiced),
    [lines],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const eligibleKey = eligible.map((l) => l.id).join('|');
  useEffect(() => {
    setSelected(new Set(eligible.map((l) => l.id)));
  }, [eligibleKey]); // eslint-disable-line react-hooks/exhaustive-deps -- sync when eligible id set changes

  if (!canEdit) return null;

  const selectedLines = eligible.filter((l) => selected.has(l.id));
  const subtotal = selectedLines.reduce((s, l) => s + effectiveSell(l), 0);
  const gst = Math.round(subtotal * 0.1 * 100) / 100;
  const total = Math.round((subtotal + gst) * 100) / 100;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-[var(--text)]">Quick invoice</h3>
          <p className="mt-1 text-sm text-[var(--text-sub)]">
            Create a draft tax invoice from uninvoiced billable cost lines (ex-GST + 10% GST).
          </p>
        </div>
        <Button
          type="button"
          disabled={!selectedLines.length || create.isPending}
          onClick={() => {
            setError(null);
            void create
              .mutateAsync({
                costLineIds: selectedLines.map((l) => l.id),
                notes: notes.trim() || null,
              })
              .then((invoice) => {
                router.push(
                  `/installhub/installations/${installationId}/invoices/${invoice.id}`,
                );
              })
              .catch((err) => setError(installHubConnectionErrorMessage(err)));
          }}
        >
          {create.isPending ? 'Creating…' : 'Create draft invoice'}
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-[var(--red)]">{error}</p> : null}

      {!eligible.length ? (
        <p className="mt-3 text-sm text-[var(--muted)]">No uninvoiced billable lines available.</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-2 font-bold">
                    <input
                      type="checkbox"
                      checked={selected.size === eligible.length && eligible.length > 0}
                      onChange={(e) => {
                        setSelected(
                          e.target.checked ? new Set(eligible.map((l) => l.id)) : new Set(),
                        );
                      }}
                      aria-label="Select all lines"
                    />
                  </th>
                  <th className="py-2 pr-2 font-bold">Description</th>
                  <th className="py-2 pr-2 font-bold">Category</th>
                  <th className="py-2 font-bold">Sell (ex GST)</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((line) => (
                  <tr key={line.id} className="border-b border-[var(--border)]/70">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={selected.has(line.id)}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(line.id);
                            else next.delete(line.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${line.description}`}
                      />
                    </td>
                    <td className="py-2 pr-2 font-semibold text-[var(--text)]">{line.description}</td>
                    <td className="py-2 pr-2 capitalize">{line.category}</td>
                    <td className="py-2">{money(effectiveSell(line), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="mt-3 block text-sm">
            <span className="font-bold text-[var(--text-sub)]">Notes (optional)</span>
            <textarea
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-2 text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <p className="mt-2 text-sm text-[var(--text-sub)]">
            Selected: {selectedLines.length} · Subtotal {money(subtotal, currency)} · GST{' '}
            {money(gst, currency)} · Total {money(total, currency)}
          </p>
        </>
      )}
    </div>
  );
}
