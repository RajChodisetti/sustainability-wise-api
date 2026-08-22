'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FieldError, FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/modules/installhub/components/WorkflowUi';
import { createInstallHubId } from '@/modules/installhub/lib/id';
import { assetElectricalSource, boardElectricalSource, primaryGridSupply } from '@/modules/installhub/lib/workflow';
import type { GridSupply, InstallationTree } from '@/modules/installhub/types/domain';

type TreeMutator = (
  mutator: (tree: InstallationTree) => void | Promise<void>,
) => Promise<InstallationTree>;

export function GridSupplyEditor({
  tree,
  mutate,
  onError,
  onSuccess,
}: {
  tree: InstallationTree;
  mutate: TreeMutator;
  onError: (error: unknown) => void;
  onSuccess: (message: string) => void;
}) {
  const [draft, setDraft] = useState<GridSupply | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const supplies = tree.gridSupplies || [];
  const removeSupply = supplies.find((supply) => supply.id === removeId);
  const references = removeSupply ? {
    boards: tree.electricalAssets.filter((board) => {
      const source = boardElectricalSource(board);
      return source.kind === 'GRID' && source.gridSupplyId === removeSupply.id;
    }).length,
    assets: tree.siteAssets.filter((asset) => {
      const source = assetElectricalSource(asset);
      return source.kind === 'GRID' && source.gridSupplyId === removeSupply.id;
    }).length,
    assignments: (tree.measurementAssignments || []).filter(
      (assignment) => assignment.target.kind === 'GRID_BOUNDARY' && assignment.target.gridSupplyId === removeSupply.id,
    ).length,
  } : { boards: 0, assets: 0, assignments: 0 };
  const referenceCount = references.boards + references.assets + references.assignments;

  function startAdd() {
    setError('');
    setDraft({
      id: createInstallHubId('grid'),
      installationId: tree.installation.id,
      name: '',
      nmi: '',
      externalKey: '',
      isDefault: supplies.length === 0,
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      await mutate((next) => {
        const value: GridSupply = {
          ...structuredClone(draft),
          installationId: next.installation.id,
          name: draft.name.trim() || 'Incoming grid connection',
          nmi: draft.nmi?.trim() || null,
          externalKey: draft.externalKey?.trim() || null,
        };
        const existing = next.gridSupplies || [];
        const index = existing.findIndex((supply) => supply.id === value.id);
        let updated = index >= 0
          ? existing.map((supply) => supply.id === value.id ? value : supply)
          : [...existing, value];
        if (value.isDefault) updated = updated.map((supply) => ({ ...supply, isDefault: supply.id === value.id }));
        if (!updated.some((supply) => supply.isDefault) && updated.length) {
          const deterministicDefaultId = [...updated].sort((left, right) => left.id.localeCompare(right.id))[0].id;
          updated = updated.map((supply) => ({ ...supply, isDefault: supply.id === deterministicDefaultId }));
        }
        next.gridSupplies = updated;
      });
      setDraft(null);
      setError('');
      onSuccess('Incoming connection saved.');
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    setBusy(true);
    try {
      await mutate((next) => {
        next.gridSupplies = (next.gridSupplies || []).map((supply) => ({
          ...supply,
          isDefault: supply.id === id,
        }));
      });
      onSuccess('Primary incoming connection updated.');
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removeSupply || referenceCount || supplies.length <= 1) return;
    setBusy(true);
    try {
      await mutate((next) => {
        const remaining = (next.gridSupplies || []).filter((supply) => supply.id !== removeSupply.id);
        if (!remaining.some((supply) => supply.isDefault) && remaining.length) {
          const deterministicDefaultId = [...remaining].sort((left, right) => left.id.localeCompare(right.id))[0].id;
          next.gridSupplies = remaining.map((supply) => ({
            ...supply,
            isDefault: supply.id === deterministicDefaultId,
          }));
          return;
        }
        next.gridSupplies = remaining;
      });
      setRemoveId(null);
      onSuccess('Incoming connection removed.');
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  const locked = tree.installation.status === 'Completed';
  const soleDefaultId = supplies.length === 1 && supplies[0].isDefault
    ? supplies[0].id
    : null;

  return (
    <Card id="grid-supplies" className="mb-6 scroll-mt-4" tabIndex={-1}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-extrabold text-[var(--text)]">Incoming electricity connection</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">The upstream connection that supplies this installation. Add another only when the site genuinely has more than one incoming supply.</p>
        </div>
        <Button variant="secondary" onClick={startAdd} disabled={locked || busy}>
          <Icon name="plus" size={16} />Add another connection
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {supplies.map((supply) => (
          <div key={supply.id} className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-[var(--text)]">{supply.id === soleDefaultId ? 'Incoming grid connection' : supply.name}</p>
                {supply.isDefault && supplies.length > 1 ? <span className="rounded-full bg-[var(--green-soft)] px-2 py-1 text-xs font-extrabold text-[var(--green)]">Primary</span> : null}
              </div>
              <p className="mt-1 text-xs text-[var(--text-sub)]">{supply.nmi ? `NMI ${supply.nmi}` : 'NMI not recorded'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!supply.isDefault ? <Button variant="ghost" disabled={locked || busy} onClick={() => void makeDefault(supply.id)}>Set default</Button> : null}
              <Button variant="secondary" disabled={locked || busy} onClick={() => { setError(''); setDraft(structuredClone(supply)); }}>Edit details</Button>
              {supplies.length > 1 ? <Button variant="ghost" className="text-[var(--red)]" disabled={locked || busy} onClick={() => setRemoveId(supply.id)}>Remove</Button> : null}
            </div>
          </div>
        ))}
      </div>
      {locked ? <FieldHint>Reopen the installation to change Grid supplies.</FieldHint> : null}

      {draft ? (
        <form onSubmit={(event) => void save(event)} className="mt-4 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-4">
          <div className="grid gap-x-4 lg:grid-cols-3">
            <div>
              <FieldLabel htmlFor="grid-supply-name" className="mt-0">Connection name</FieldLabel>
              <Input id="grid-supply-name" value={draft.name} placeholder="Defaults to Incoming grid connection" aria-invalid={Boolean(error)} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              <FieldError message={error} />
            </div>
            <div>
              <FieldLabel htmlFor="grid-supply-nmi" className="mt-0">NMI (optional)</FieldLabel>
              <Input id="grid-supply-nmi" value={draft.nmi || ''} maxLength={100} onChange={(event) => setDraft({ ...draft, nmi: event.target.value })} />
            </div>
          </div>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-[var(--text)]">
            <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />
            Use this as the primary incoming connection
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save connection'}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        open={Boolean(removeSupply)}
        title={`Remove ${removeSupply?.name || 'Grid supply'}?`}
        description="A Grid supply can be removed only after all exact references have been reconciled."
        consequences={[
          `${references.boards} switchboard source reference${references.boards === 1 ? '' : 's'}`,
          `${references.assets} site asset source reference${references.assets === 1 ? '' : 's'}`,
          `${references.assignments} measurement boundary reference${references.assignments === 1 ? '' : 's'}`,
          removeSupply?.isDefault && supplies.length > 1 ? `${primaryGridSupply({ ...tree, gridSupplies: supplies.filter((item) => item.id !== removeSupply.id) }).name} will become the default` : 'The existing default will remain unchanged',
        ]}
        confirmLabel="Remove Grid supply"
        busy={busy}
        blockedMessage={locked
          ? 'Reopen the installation before removing a Grid supply.'
          : supplies.length <= 1
            ? 'An installation must retain one active default Grid supply.'
            : referenceCount
              ? 'Reconcile every listed reference before removing this Grid supply.'
              : undefined}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveId(null)}
      />
    </Card>
  );
}
