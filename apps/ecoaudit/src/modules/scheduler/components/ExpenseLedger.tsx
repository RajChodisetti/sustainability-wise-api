'use client';

import { useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button, buttonClassName } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Card';
import { Checkbox, FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import {
  downloadSchedulerExpenseAttachment,
} from '@/modules/scheduler/api/client';
import {
  useCreateSchedulerExpense,
  useDeleteSchedulerExpenseAttachment,
  useDeleteSchedulerExpense,
  useUpdateSchedulerExpense,
  useUploadSchedulerExpenseAttachment,
} from '@/modules/scheduler/hooks/useScheduler';
import { billAttachmentValidation } from '@/modules/scheduler/lib/finance';
import type {
  FinanceExpense,
  FinanceExpenseCategory,
  FinanceExpenseInput,
  FinanceExpenseKind,
} from '@/modules/scheduler/types/domain';

const categories: Array<{ value: FinanceExpenseCategory; label: string }> = [
  { value: 'materials', label: 'Materials' },
  { value: 'travel', label: 'Travel' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
];

function money(value: number | null, currency: string): string {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dateInput(value: string | null): string {
  return value?.slice(0, 10) ?? '';
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function initialForm(expense?: FinanceExpense | null, newKind: FinanceExpenseKind = 'expense') {
  return {
    kind: expense?.kind ?? newKind,
    category: expense?.category ?? 'materials' as FinanceExpenseCategory,
    description: expense?.description ?? '',
    vendor: expense?.vendor ?? '',
    reference: expense?.reference ?? '',
    incurredAt: dateInput(expense?.incurredAt ?? null),
    costAmount: expense?.costAmount.toString() ?? '',
    billableAmount: expense?.billableAmount?.toString() ?? '',
    billable: expense?.billable ?? true,
  };
}

export function ExpenseLedger({
  financeId,
  currency,
  expenses,
}: {
  financeId: string;
  currency: string;
  expenses: FinanceExpense[];
}) {
  const toast = useToast();
  const create = useCreateSchedulerExpense(financeId);
  const update = useUpdateSchedulerExpense(financeId);
  const remove = useDeleteSchedulerExpense(financeId);
  const upload = useUploadSchedulerExpenseAttachment(financeId);
  const deleteAttachment = useDeleteSchedulerExpenseAttachment(financeId);
  const [editing, setEditing] = useState<FinanceExpense | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(initialForm());
  const [error, setError] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const busy = create.isPending || update.isPending || remove.isPending
    || upload.isPending || deleteAttachment.isPending;

  function openNew(kind: FinanceExpenseKind) {
    setEditing(null);
    setForm(initialForm(null, kind));
    setError(null);
    setFormOpen(true);
  }

  function openEdit(expense: FinanceExpense) {
    setEditing(expense);
    setForm(initialForm(expense));
    setError(null);
    setFormOpen(true);
  }

  async function saveExpense() {
    setError(null);
    const costAmount = Number(form.costAmount);
    const billableAmount = form.billableAmount.trim() ? Number(form.billableAmount) : null;
    if (!form.description.trim()) {
      setError('Add a description for this expense or supplier bill.');
      return;
    }
    if (!Number.isFinite(costAmount) || costAmount < 0) {
      setError('Cost amount must be a valid amount of zero or more.');
      return;
    }
    if (billableAmount != null && (!Number.isFinite(billableAmount) || billableAmount < 0)) {
      setError('Sell amount must be a valid amount of zero or more.');
      return;
    }
    const input: FinanceExpenseInput = {
      kind: form.kind,
      category: form.category,
      description: form.description.trim(),
      vendor: form.vendor.trim() || null,
      reference: form.reference.trim() || null,
      incurredAt: form.incurredAt || null,
      costAmount,
      billable: form.billable,
      billableAmount: form.billable ? billableAmount : null,
    };
    try {
      if (editing) {
        await update.mutateAsync({ expenseId: editing.id, input });
        toast.success('Expense updated.');
      } else {
        await create.mutateAsync(input);
        toast.success(form.kind === 'supplier_bill' ? 'Supplier bill added.' : 'Expense added.');
      }
      setFormOpen(false);
      setEditing(null);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  async function deleteExpense(expense: FinanceExpense) {
    if (!window.confirm(`Delete “${expense.description}”?`)) return;
    setError(null);
    try {
      await remove.mutateAsync(expense.id);
      toast.success('Expense deleted.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  async function uploadAttachment(expense: FinanceExpense, file?: File) {
    if (!file) return;
    const fileIssue = billAttachmentValidation(file);
    if (fileIssue) {
      setError(fileIssue);
      return;
    }
    setRowBusyId(expense.id);
    setError(null);
    try {
      await upload.mutateAsync({ expenseId: expense.id, file });
      toast.success('Bill attachment uploaded.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    } finally {
      setRowBusyId(null);
    }
  }

  async function downloadAttachment(
    expense: FinanceExpense,
    attachmentId: string,
    filename: string,
  ) {
    setRowBusyId(expense.id);
    setError(null);
    try {
      saveBlob(await downloadSchedulerExpenseAttachment(expense.id, attachmentId), filename);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    } finally {
      setRowBusyId(null);
    }
  }

  async function removeAttachment(
    expense: FinanceExpense,
    attachmentId: string,
    filename: string,
  ) {
    if (!window.confirm(`Delete attachment “${filename}”? The cost record will remain.`)) return;
    setRowBusyId(expense.id);
    setError(null);
    try {
      await deleteAttachment.mutateAsync({ expenseId: expense.id, attachmentId });
      toast.success('Bill attachment deleted.');
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5" aria-labelledby="expense-ledger-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="expense-ledger-heading" className="font-extrabold text-[var(--text)]">Bills, expenses & extra costs</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Add supplier bills or other job costs, set their customer charge, and retain private evidence.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button className="w-full sm:w-auto" type="button" variant="secondary" onClick={() => openNew('expense')}>+ Add extra cost</Button>
          <Button className="w-full sm:w-auto" type="button" onClick={() => openNew('supplier_bill')}>+ Add supplier bill</Button>
        </div>
      </div>

      {formOpen ? (
        <div className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface2)] p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-extrabold text-[var(--text)]">{editing ? 'Edit cost' : form.kind === 'supplier_bill' ? 'New supplier bill' : 'New extra cost'}</h3>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setFormOpen(false)}>Close</Button>
          </div>
          <div className="grid gap-x-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <FieldLabel htmlFor="expense-kind">Record type</FieldLabel>
              <Select id="expense-kind" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as FinanceExpenseKind })}>
                <option value="expense">Expense</option>
                <option value="supplier_bill">Supplier bill</option>
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="expense-category">Category</FieldLabel>
              <Select id="expense-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as FinanceExpenseCategory })}>
                {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="expense-date">Date</FieldLabel>
              <Input id="expense-date" type="date" value={form.incurredAt} onChange={(event) => setForm({ ...form, incurredAt: event.target.value })} />
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <FieldLabel htmlFor="expense-description">Description</FieldLabel>
              <Input id="expense-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="expense-vendor">Vendor</FieldLabel>
              <Input id="expense-vendor" value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="expense-reference">Reference / bill number</FieldLabel>
              <Input id="expense-reference" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="expense-cost">Cost (ex GST)</FieldLabel>
              <Input id="expense-cost" type="number" min="0" step="0.01" inputMode="decimal" value={form.costAmount} onChange={(event) => setForm({ ...form, costAmount: event.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="expense-sell">Sell (ex GST)</FieldLabel>
              <Input id="expense-sell" type="number" min="0" step="0.01" inputMode="decimal" value={form.billableAmount} onChange={(event) => setForm({ ...form, billableAmount: event.target.value })} disabled={!form.billable} />
              <FieldHint>Leave blank to bill this cost at cost.</FieldHint>
            </div>
            <div className="self-end">
              <Checkbox label="Billable to customer" checked={form.billable} onChange={(billable) => setForm({ ...form, billable })} />
              <FieldHint>Only billable, uninvoiced costs can be selected for a draft.</FieldHint>
            </div>
          </div>
          {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => void saveExpense()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add cost'}</Button>
          </div>
        </div>
      ) : null}

      {!formOpen && error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

      {expenses.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-sub)]">No expenses or supplier bills recorded.</p>
      ) : (
        <>
          <div className="mt-4 space-y-2 md:hidden">
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                currency={currency}
                busy={busy || rowBusyId === expense.id}
                onEdit={openEdit}
                onDelete={deleteExpense}
                onUpload={uploadAttachment}
                onDownload={downloadAttachment}
                onDeleteAttachment={removeAttachment}
              />
            ))}
          </div>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--text-sub)]">
                  <th className="px-2 py-2 font-bold">Cost</th>
                  <th className="px-2 py-2 font-bold">Vendor / reference</th>
                  <th className="px-2 py-2 text-right font-bold">Cost</th>
                  <th className="px-2 py-2 text-right font-bold">Sell</th>
                  <th className="px-2 py-2 text-right font-bold">Markup</th>
                  <th className="px-2 py-2 font-bold">Evidence / state</th>
                  <th className="px-2 py-2 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id} className="border-b border-[var(--border)]/70 align-top">
                    <td className="px-2 py-3">
                      <span className="font-bold text-[var(--text)]">{expense.description}</span>
                      <span className="mt-0.5 block text-xs capitalize text-[var(--text-sub)]">{expense.kind.replace('_', ' ')} · {expense.category}</span>
                    </td>
                    <td className="px-2 py-3 text-[var(--text-sub)]">{expense.vendor || '—'}{expense.reference ? <span className="block text-xs">{expense.reference}</span> : null}</td>
                    <td className="px-2 py-3 text-right font-semibold">{money(expense.costAmount, currency)}</td>
                    <td className="px-2 py-3 text-right font-semibold">
                      {expense.billable ? money(expense.effectiveBillableAmount, currency) : 'Non-billable'}
                      {expense.billable && expense.billableAmount == null ? <span className="block text-[10px] font-medium text-[var(--text-sub)]">at cost</span> : null}
                    </td>
                    <td className="px-2 py-3 text-right">{expense.markupPct == null ? '—' : `${expense.markupPct.toFixed(1)}%`}</td>
                    <td className="px-2 py-3">
                      <ExpenseAttachments
                        expense={expense}
                        busy={busy || rowBusyId === expense.id}
                        onUpload={uploadAttachment}
                        onDownload={downloadAttachment}
                        onDeleteAttachment={removeAttachment}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" disabled={busy || expense.invoiced || expense.reserved} onClick={() => openEdit(expense)}>Edit</Button>
                        <Button type="button" variant="ghost" disabled={busy || expense.invoiced || expense.reserved} onClick={() => void deleteExpense(expense)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ExpenseState({ expense }: { expense: FinanceExpense }) {
  if (expense.invoiced) return <span className="rounded-full bg-[var(--green-soft)] px-2 py-1 text-xs font-bold text-[var(--green)]">Invoiced</span>;
  if (expense.reserved) return <span className="rounded-full bg-[var(--primary-soft)] px-2 py-1 text-xs font-bold text-[var(--primary)]">In draft</span>;
  if (!expense.billable) return <span className="rounded-full bg-[var(--surface2)] px-2 py-1 text-xs font-bold text-[var(--text-sub)]">Cost only</span>;
  return <span className="rounded-full bg-[var(--amber-soft)] px-2 py-1 text-xs font-bold text-[var(--amber)]">Unbilled</span>;
}

function ExpenseCard({
  expense,
  currency,
  busy,
  onEdit,
  onDelete,
  onUpload,
  onDownload,
  onDeleteAttachment,
}: {
  expense: FinanceExpense;
  currency: string;
  busy: boolean;
  onEdit: (expense: FinanceExpense) => void;
  onDelete: (expense: FinanceExpense) => Promise<void>;
  onUpload: (expense: FinanceExpense, file?: File) => Promise<void>;
  onDownload: (expense: FinanceExpense, attachmentId: string, filename: string) => Promise<void>;
  onDeleteAttachment: (expense: FinanceExpense, attachmentId: string, filename: string) => Promise<void>;
}) {
  return (
    <article className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-[var(--text)]">{expense.description}</h3>
          <p className="mt-0.5 text-xs capitalize text-[var(--text-sub)]">{expense.kind.replace('_', ' ')} · {expense.category}</p>
        </div>
        <ExpenseState expense={expense} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-[var(--text-sub)]">Cost</dt><dd className="font-extrabold">{money(expense.costAmount, currency)}</dd></div>
        <div><dt className="text-xs text-[var(--text-sub)]">Sell</dt><dd className="font-extrabold">{expense.billable ? money(expense.effectiveBillableAmount, currency) : 'Non-billable'}{expense.billable && expense.billableAmount == null ? <span className="ml-1 text-[10px] font-medium text-[var(--text-sub)]">at cost</span> : null}</dd></div>
        <div><dt className="text-xs text-[var(--text-sub)]">Vendor</dt><dd className="truncate">{expense.vendor || '—'}</dd></div>
        <div><dt className="text-xs text-[var(--text-sub)]">Reference</dt><dd className="truncate">{expense.reference || '—'}</dd></div>
      </dl>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <ExpenseAttachments
          expense={expense}
          busy={busy}
          showState={false}
          onUpload={onUpload}
          onDownload={onDownload}
          onDeleteAttachment={onDeleteAttachment}
        />
      </div>
      {!expense.invoiced && !expense.reserved ? (
        <div className="mt-3 flex justify-end gap-1">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onEdit(expense)}>Edit</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void onDelete(expense)}>Delete</Button>
        </div>
      ) : null}
    </article>
  );
}

function ExpenseAttachments({
  expense,
  busy,
  onUpload,
  onDownload,
  onDeleteAttachment,
  showState = true,
}: {
  expense: FinanceExpense;
  busy: boolean;
  onUpload: (expense: FinanceExpense, file?: File) => Promise<void>;
  onDownload: (expense: FinanceExpense, attachmentId: string, filename: string) => Promise<void>;
  onDeleteAttachment: (expense: FinanceExpense, attachmentId: string, filename: string) => Promise<void>;
  showState?: boolean;
}) {
  const locked = expense.invoiced || expense.reserved;
  return (
    <div className="min-w-[10rem] space-y-2">
      {showState ? <ExpenseState expense={expense} /> : null}
      {(expense.attachments ?? []).map((attachment) => (
        <div key={attachment.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 py-1.5 text-xs">
          <span className="block max-w-48 truncate font-semibold text-[var(--text)]" title={attachment.filename}>{attachment.filename}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            <button type="button" aria-label={`Download ${attachment.filename}`} className="min-h-11 px-2 font-bold text-[var(--primary)] hover:underline" disabled={busy} onClick={() => void onDownload(expense, attachment.id, attachment.filename)}>Download</button>
            <button type="button" aria-label={`Delete ${attachment.filename}`} className="min-h-11 px-2 font-bold text-[var(--red)] hover:underline disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || locked} onClick={() => void onDeleteAttachment(expense, attachment.id, attachment.filename)}>Delete</button>
          </div>
        </div>
      ))}
      <label className={buttonClassName('ghost', `w-full !px-2 focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] ${locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`)}>
        {busy ? 'Uploading…' : expense.attachments.length ? 'Add attachment' : 'Attach bill'}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy || locked}
          onChange={(event) => {
            void onUpload(expense, event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      {locked ? <p className="text-[10px] leading-4 text-[var(--text-sub)]">Invoice-linked evidence is read-only.</p> : null}
    </div>
  );
}
