'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed editor from its server query record */

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldError, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, InlineNotice, RecordNavigation } from '@/modules/installhub/components/InstallHubUi';
import {
  ChoiceGroup,
  ConfirmDialog,
  ErrorSummary,
  SaveStateNotice,
  TreeDraftNavigationGuard,
  requestTreeNavigation,
} from '@/modules/installhub/components/WorkflowUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { uploadInstallationPhoto } from '@/modules/installhub/api/installhub';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import { createBoard, nowIso } from '@/modules/installhub/lib/model';
import { pinSelectedResult } from '@/modules/installhub/lib/electricalPresentation';
import type { ElectricalAsset, ElectricalSourceKind } from '@/modules/installhub/types/domain';
import {
  BOARD_TYPE_OPTIONS,
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  assetElectricalSource,
  boardDependencyPreview,
  boardElectricalSource,
  boardTypeCode,
  displayCodeMetadata,
  displayCodeValue,
  legacyBoardType,
  primaryGridSupply,
  reconcileRemovedMeter,
  setAssetMetering,
  validBoardParents,
} from '@/modules/installhub/lib/workflow';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import { useToast } from '@/contexts/ToastContext';

export function InstallHubBoardPage({ mode }: { mode: 'new' | 'edit' }) {
  const { installationId, zoneId, boardId } = useParams<{
    installationId: string;
    zoneId: string;
    boardId?: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<ElectricalAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [errors, setErrors] = useState<Array<{ id?: string; message: string }>>([]);
  const [confirmMeterRemoval, setConfirmMeterRemoval] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const source = query.data?.electricalAssets.find((item) => item.id === boardId);
  useEffect(() => {
    if (mode === 'new') {
      setDraft((current) => current ?? createBoard(installationId, zoneId));
    } else if (source) {
      setDraft(structuredClone(source));
    }
  }, [installationId, mode, source, zoneId]);

  if (query.isLoading || !draft) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (mode === 'edit' && !source) return <ErrorBanner message="Switchboard not found." />;
  const tree = query.data!;
  const zone = tree.zones.find((item) => item.id === zoneId);
  if (!zone) return <ErrorBanner message="Zone not found." />;
  const saved = mode === 'edit';
  const currentDraft = draft;
  const allAvailableParents = validBoardParents(tree, draft.id);
  const normalizedSearch = parentSearch.trim().toLowerCase();
  const matchingParents = allAvailableParents.filter((item) => {
    if (!normalizedSearch) return true;
    const itemZone = tree.zones.find((candidate) => candidate.id === item.zoneId);
    return `${displayCodeValue(item)} ${item.assetName} ${item.assetType} ${itemZone?.zoneName || ''}`
      .toLowerCase()
      .includes(normalizedSearch);
  });
  const sourceForParentSelection = boardElectricalSource(draft);
  const selectedParentId = sourceForParentSelection.kind === 'BOARD'
    ? sourceForParentSelection.boardId
    : null;
  const availableParents = pinSelectedResult(matchingParents, allAvailableParents, selectedParentId, (item) => item.id);
  const forms = tree.formSubmissions.filter((item) => item.boardId === boardId);
  const draftSource = boardElectricalSource(draft);
  const sourceKind = draftSource.kind;
  const parentBoard = draftSource.kind === 'BOARD'
    ? tree.electricalAssets.find((item) => item.id === draftSource.boardId)
    : undefined;
  const downstreamBoards = tree.electricalAssets.filter((item) => {
    const electricalSource = boardElectricalSource(item);
    return item.id !== draft.id && electricalSource.kind === 'BOARD' && electricalSource.boardId === draft.id;
  });
  const suppliedAssets = tree.siteAssets.filter((item) => {
    const electricalSource = assetElectricalSource(item);
    return electricalSource.kind === 'BOARD' && electricalSource.boardId === draft.id;
  });
  const dependencyPreview = boardDependencyPreview(tree, draft.id);
  const codeMeta = displayCodeMetadata(
    tree,
    boardTypeCode(draft),
    draft.displayCode,
    draft.displayCodeMeta,
    draft.id,
  );
  const hasLocalChanges = mode === 'new'
    || Boolean(source && JSON.stringify(draft) !== JSON.stringify(source));

  function set<K extends keyof ElectricalAsset>(key: K, value: ElectricalAsset[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const nextErrors: Array<{ id?: string; message: string }> = [];
    if (!currentDraft.assetName.trim()) nextErrors.push({ id: 'board-name', message: 'Enter the switchboard name.' });
    if (boardTypeCode(currentDraft) === 'OTHER' && !currentDraft.customTypeName?.trim()) {
      nextErrors.push({ id: 'board-custom-type', message: 'Enter the custom switchboard type.' });
    }
    const electricalSource = boardElectricalSource(currentDraft);
    if (electricalSource.kind === 'BOARD' && !electricalSource.boardId) {
      nextErrors.push({ id: 'board-parent', message: 'Choose the confirmed parent switchboard.' });
    }
    const code = displayCodeMetadata(
      tree,
      boardTypeCode(currentDraft),
      currentDraft.displayCode,
      currentDraft.displayCodeMeta,
      currentDraft.id,
    ).value;
    if (!code.trim()) nextErrors.push({ id: 'board-code', message: 'Enter or generate a display code.' });
    setErrors(nextErrors);
    if (nextErrors.length) {
      document.getElementById(nextErrors[0].id || '')?.focus();
      toast.error('Check the highlighted switchboard fields.');
      return;
    }
    setBusy(true);
    try {
      await writer.mutate((next) => {
        if (!currentDraft.meterPresent) {
          const existing = next.electricalAssets.find((item) => item.id === currentDraft.id);
          for (const meter of existing?.meters || []) reconcileRemovedMeter(next, meter.id);
        }
        const value: ElectricalAsset = {
          ...structuredClone(currentDraft),
          meters: currentDraft.meterPresent
            ? currentDraft.meters.filter((meter) => meter.lifecycleState !== 'INACTIVE')
            : [],
          assetName: currentDraft.assetName.trim(),
          assetType: legacyBoardType(boardTypeCode(currentDraft)),
          typeCode: boardTypeCode(currentDraft),
          customTypeName: boardTypeCode(currentDraft) === 'OTHER' ? currentDraft.customTypeName?.trim() : null,
          displayCode: code.trim(),
          displayCodeMeta: {
            ...displayCodeMetadata(next, boardTypeCode(currentDraft), code, currentDraft.displayCodeMeta, currentDraft.id),
            value: code.trim(),
          },
          updatedAt: nowIso(),
        };
        applyBoardElectricalSource(value, electricalSource);
        const index = next.electricalAssets.findIndex((item) => item.id === value.id);
        if (index >= 0) next.electricalAssets[index] = value;
        else next.electricalAssets.push(value);
      });
      setErrors([]);
      toast.success(saved ? 'Switchboard saved.' : 'Switchboard created.');
      if (!saved) {
        router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/boards/${currentDraft.id}`);
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadMain(files: File[]) {
    const file = files[0];
    if (!file || !boardId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.electricalAssets.find((item) => item.id === boardId);
        if (!target) throw new Error('Switchboard not found.');
        target.photo = await uploadInstallationPhoto(next, {
          installationId,
          entityType: 'electrical_asset',
          entityId: boardId,
          fieldName: 'photo',
        }, file);
        target.updatedAt = nowIso();
      });
      toast.success('Switchboard photo uploaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function uploadExtra(files: File[]) {
    if (!boardId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.electricalAssets.find((item) => item.id === boardId);
        if (!target) throw new Error('Switchboard not found.');
        for (const file of files) {
          const index = target.extraPhotos.length;
          const uri = await uploadInstallationPhoto(next, {
            installationId,
            entityType: 'electrical_asset',
            entityId: boardId,
            fieldName: `extraPhotos[${index}]`,
          }, file);
          target.extraPhotos.push(uri);
        }
        target.updatedAt = nowIso();
      });
      toast.success(`${files.length} evidence photo${files.length === 1 ? '' : 's'} uploaded.`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(kind: 'main' | 'extra', id?: string) {
    try {
      await writer.mutate((next) => {
        const target = next.electricalAssets.find((item) => item.id === boardId);
        if (!target) return;
        if (kind === 'main') target.photo = null;
        else {
          const photoIndex = Number(id);
          if (!Number.isInteger(photoIndex)) return;
          target.extraPhotos = target.extraPhotos.filter(
            (_, index) => index !== photoIndex,
          );
        }
        target.updatedAt = nowIso();
      });
      toast.success('Photo removed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeBoard() {
    if (!boardId) return;
    try {
      await writer.mutate((next) => {
        const meterIds = new Set(
          next.electricalAssets.find((item) => item.id === boardId)?.meters.map((item) => item.id) ?? [],
        );
        for (const meterId of meterIds) reconcileRemovedMeter(next, meterId);
        next.electricalAssets = next.electricalAssets.filter((item) => item.id !== boardId);
        for (const item of next.electricalAssets) {
          const itemSource = boardElectricalSource(item);
          if (itemSource.kind === 'BOARD' && itemSource.boardId === boardId) {
            applyBoardElectricalSource(item, { kind: 'TBC' });
          }
        }
        for (const item of next.siteAssets) {
          const itemSource = assetElectricalSource(item);
          if (itemSource.kind === 'BOARD' && itemSource.boardId === boardId) {
            applyAssetElectricalSource(item, { kind: 'TBC' });
          }
          if (item.meterSwitchboardId === boardId || (item.meterId && meterIds.has(item.meterId))) {
            setAssetMetering(next, item, { kind: 'TBC' });
          }
        }
        next.measurementAssignments = (next.measurementAssignments || []).filter(
          (assignment) => !meterIds.has(assignment.meterId),
        );
        next.meterDevices = (next.meterDevices || []).filter(
          (meter) => !meterIds.has(meter.id),
        );
        next.formSubmissions = next.formSubmissions.map(
          (item) => item.status === 'Draft' && (item.boardId === boardId || meterIds.has(item.meterId ?? ''))
            ? { ...item, boardId: null, meterId: null }
            : item,
        );
      });
      setConfirmDelete(false);
      toast.success('Switchboard deleted. Dependent draft relationships are ready for reconciliation.');
      router.replace(`/installhub/installations/${installationId}/zones/${zoneId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  function chooseSource(kind: ElectricalSourceKind) {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      if (kind === 'GRID') applyBoardElectricalSource(next, { kind: 'GRID', gridSupplyId: primaryGridSupply(tree).id });
      else if (kind === 'BOARD') applyBoardElectricalSource(next, { kind: 'BOARD', boardId: '' });
      else applyBoardElectricalSource(next, { kind: 'TBC' });
      return next;
    });
  }

  function chooseMeterPresent(value: 'YES' | 'NO') {
    if (value === 'YES') {
      set('meterPresent', true);
      return;
    }
    if (currentDraft.meters.length > 0 || forms.length > 0) {
      setConfirmMeterRemoval(true);
      return;
    }
    set('meterPresent', false);
  }

  function confirmNoMeter() {
    setDraft((current) => current ? {
      ...current,
      meterPresent: false,
      meters: [],
    } : current);
    setConfirmMeterRemoval(false);
  }

  function chooseBoardType(value: string) {
    setDraft((current) => {
      if (!current) return current;
      const nextMeta = displayCodeMetadata(
        tree,
        value,
        '',
        current.displayCodeMeta,
        current.id,
        !saved,
      );
      return {
        ...current,
        typeCode: value,
        assetType: legacyBoardType(value),
        customTypeName: value === 'OTHER' ? current.customTypeName : null,
        displayCode: current.displayCodeMeta?.isOverridden ? current.displayCode : nextMeta.value,
        displayCodeMeta: current.displayCodeMeta?.isOverridden
          ? { ...current.displayCodeMeta, generatedValue: nextMeta.generatedValue }
          : nextMeta,
      };
    });
  }

  function setCodeOverride(checked: boolean) {
    setDraft((current) => {
      if (!current) return current;
      const nextMeta = displayCodeMetadata(tree, boardTypeCode(current), '', undefined, current.id);
      return {
        ...current,
        displayCode: checked ? displayCodeValue(current) : nextMeta.value,
        displayCodeMeta: {
          ...nextMeta,
          value: checked ? displayCodeValue(current) : nextMeta.value,
          isOverridden: checked,
        },
      };
    });
  }

  const latest = query.data!.electricalAssets.find((item) => item.id === boardId) ?? draft;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: zone.zoneName, href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: mode === 'new' ? 'New switchboard' : draft.assetName || 'Switchboard' },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'New switchboard' : draft.assetName || 'Switchboard'}
        subtitle="Electrical hierarchy, installed Wattwatcher meters, and switchboard evidence."
        actions={saved ? (
          <>
            <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&boardId=${boardId}`} variant="secondary">
              <Icon name="clipboard" size={17} />New field form
            </LinkButton>
            <LinkButton href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/new`}>
              <Icon name="plus" size={17} />Add meter
            </LinkButton>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        ) : undefined}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-sub)]">
          Physical zone: <strong className="text-[var(--text)]">{zone.zoneName}</strong>
        </p>
        <SaveStateNotice
          state={writer.writeState}
          onRetry={() => void writer.retry().catch((error) => toast.error(installHubConnectionErrorMessage(error)))}
          onDiscard={() => void writer.discard()}
        />
      </div>

      {saved ? (
        <RecordNavigation
          title="Switchboard navigation"
          description="Move between this board's physical location, electrical parent and children, installed meters, and evidence."
          items={[
            {
              href: `/installhub/installations/${installationId}/zones/${zoneId}`,
              icon: 'map-pin',
              label: 'Physical zone',
              description: zone.zoneName,
            },
            ...(parentBoard ? [{
              href: `/installhub/installations/${installationId}/zones/${parentBoard.zoneId}/boards/${parentBoard.id}`,
              icon: 'zap' as const,
              label: 'Electrical parent',
              description: `${displayCodeValue(parentBoard)} — ${parentBoard.assetName}`,
            }] : [{
              href: '#board-supply',
              icon: 'grid' as const,
              label: sourceKind === 'GRID' ? 'Grid supply' : 'Supply to confirm',
              description: sourceKind === 'GRID' ? primaryGridSupply(tree).name : 'Open the supply section',
            }]),
            {
              href: '#board-relationships',
              icon: 'plug',
              label: 'Electrical children',
              description: 'Downstream boards and supplied assets',
              meta: downstreamBoards.length + suppliedAssets.length,
            },
            {
              href: '#board-meters',
              icon: 'gauge',
              label: 'Installed meters',
              description: 'Devices and their channels',
              meta: latest.meters.length,
            },
            {
              href: '#board-evidence',
              icon: 'camera',
              label: 'Switchboard evidence',
              description: 'Board and location photos',
              meta: (latest.photo ? 1 : 0) + latest.extraPhotos.length,
            },
          ]}
        />
      ) : null}

      <TreeDraftNavigationGuard active={!busy && !uploading && (hasLocalChanges || writer.hasPendingTree)} onDiscard={writer.discard} />

      <ErrorSummary errors={errors} />

      <form onSubmit={(event) => void save(event)}>
        <Card className="mb-5">
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="board-name">Switchboard name *</FieldLabel>
              <Input
                id="board-name"
                value={draft.assetName}
                required
                aria-invalid={errors.some((item) => item.id === 'board-name')}
                aria-describedby={errors.some((item) => item.id === 'board-name') ? 'board-name-error' : undefined}
                onChange={(event) => set('assetName', event.target.value)}
              />
              <FieldError id="board-name-error" message={errors.find((item) => item.id === 'board-name')?.message} />
            </div>
            <div>
              <FieldLabel htmlFor="board-type">Switchboard type *</FieldLabel>
              <Select id="board-type" value={boardTypeCode(draft)} onChange={(event) => chooseBoardType(event.target.value)}>
                {BOARD_TYPE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>{option.label}</option>
                ))}
              </Select>
            </div>
            {boardTypeCode(draft) === 'OTHER' ? (
              <div>
                <FieldLabel htmlFor="board-custom-type">Custom switchboard type *</FieldLabel>
                <Input
                  id="board-custom-type"
                  value={draft.customTypeName ?? ''}
                  aria-invalid={errors.some((item) => item.id === 'board-custom-type')}
                  aria-describedby={errors.some((item) => item.id === 'board-custom-type') ? 'board-custom-type-error' : undefined}
                  onChange={(event) => set('customTypeName', event.target.value)}
                />
                <FieldError id="board-custom-type-error" message={errors.find((item) => item.id === 'board-custom-type')?.message} />
              </div>
            ) : null}
            <div>
              <FieldLabel htmlFor="board-code">Display code *</FieldLabel>
              <Input
                id="board-code"
                value={codeMeta.value}
                readOnly={!codeMeta.isOverridden}
                required
                aria-invalid={errors.some((item) => item.id === 'board-code')}
                aria-describedby="board-code-hint"
                onChange={(event) => setDraft((current) => current ? {
                  ...current,
                  displayCode: event.target.value,
                  displayCodeMeta: { ...codeMeta, value: event.target.value, isOverridden: true },
                } : current)}
              />
              <FieldHint id="board-code-hint">
                Generated from site and type. The custom-code option preserves an intentional override.
              </FieldHint>
              <FieldError message={errors.find((item) => item.id === 'board-code')?.message} />
              <Checkbox label="Use a custom display code" checked={codeMeta.isOverridden} onChange={setCodeOverride} />
            </div>
            <div>
              <FieldLabel htmlFor="board-location">Location description</FieldLabel>
              <Input id="board-location" value={draft.locationDescription ?? ''} onChange={(event) => set('locationDescription', event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor="board-nmi">Site NMI</FieldLabel>
              <Input id="board-nmi" value={draft.siteNmi ?? ''} onChange={(event) => set('siteNmi', event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor="board-phase">Phase</FieldLabel>
              <Input id="board-phase" value={draft.phase ?? ''} onChange={(event) => set('phase', event.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor="board-amperage">Amperage rating</FieldLabel>
              <Input id="board-amperage" value={draft.amperageRating ?? ''} onChange={(event) => set('amperageRating', event.target.value)} />
            </div>
          </div>

          <div id="board-supply" tabIndex={-1} className="mt-6 border-t border-[var(--border)] pt-2">
            <ChoiceGroup<ElectricalSourceKind>
              label="What supplies this switchboard?"
              hint="Choose the confirmed electrical source. Physical zone and electrical parent are separate relationships."
              value={sourceKind}
              options={[
                { value: 'GRID', label: 'Grid / incoming supply', description: primaryGridSupply(tree).name },
                { value: 'BOARD', label: 'Another switchboard', description: 'Select a parent anywhere in this installation.' },
                { value: 'TBC', label: 'To be confirmed', description: 'Save the uncertainty for reconciliation.' },
              ]}
              onChange={chooseSource}
            />
            {sourceKind === 'GRID' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <FieldLabel htmlFor="board-grid-supply" className="mt-0">Grid supply *</FieldLabel>
                <Select
                  id="board-grid-supply"
                  value={draftSource.gridSupplyId}
                  onChange={(event) => setDraft((current) => {
                    if (!current) return current;
                    const next = structuredClone(current);
                    applyBoardElectricalSource(next, { kind: 'GRID', gridSupplyId: event.target.value });
                    return next;
                  })}
                >
                  {(tree.gridSupplies || []).map((supply) => (
                    <option key={supply.id} value={supply.id}>
                      {supply.name}{supply.nmi ? ` · NMI ${supply.nmi}` : ''}{supply.isDefault ? ' · Default' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            {sourceKind === 'BOARD' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <FieldLabel htmlFor="board-parent-search" className="mt-0">Find a parent switchboard</FieldLabel>
                <Input
                  id="board-parent-search"
                  type="search"
                  value={parentSearch}
                  placeholder="Search code, name, type, or zone"
                  onChange={(event) => setParentSearch(event.target.value)}
                />
                <FieldLabel htmlFor="board-parent">Confirmed parent *</FieldLabel>
                <Select
                  id="board-parent"
                  value={draftSource.kind === 'BOARD' ? draftSource.boardId : ''}
                  aria-invalid={errors.some((item) => item.id === 'board-parent')}
                  aria-describedby={errors.some((item) => item.id === 'board-parent') ? 'board-parent-error' : undefined}
                  onChange={(event) => setDraft((current) => {
                    if (!current) return current;
                    const next = structuredClone(current);
                    applyBoardElectricalSource(next, { kind: 'BOARD', boardId: event.target.value });
                    return next;
                  })}
                >
                  <option value="">Choose a switchboard</option>
                  {availableParents.map((board) => {
                    const parentZone = tree.zones.find((item) => item.id === board.zoneId);
                    return (
                      <option key={board.id} value={board.id}>
                        {displayCodeValue(board)} — {board.assetName} · {parentZone?.zoneName || 'Unknown zone'}
                      </option>
                    );
                  })}
                </Select>
                <FieldError id="board-parent-error" message={errors.find((item) => item.id === 'board-parent')?.message} />
                <FieldHint>Showing at most 100 eligible matches. Refine the search for large installations.</FieldHint>
                {availableParents.length === 0 ? <FieldHint>No eligible switchboards match this search.</FieldHint> : null}
              </div>
            ) : null}
            {sourceKind === 'TBC' ? (
              <InlineNotice>Unresolved source will appear in reconciliation and block completion.</InlineNotice>
            ) : null}
          </div>

          <div id="board-meter-presence" tabIndex={-1}>
            <ChoiceGroup<'YES' | 'NO'>
              label="Is a metering device installed on this switchboard?"
              value={draft.meterPresent || draft.meters.some((meter) => meter.lifecycleState !== 'INACTIVE') ? 'YES' : 'NO'}
              options={[
                { value: 'YES', label: 'Yes', description: 'Capture the installed device and channels after saving.' },
                { value: 'NO', label: 'No', description: 'This switchboard has no installed meter.' },
              ]}
              onChange={chooseMeterPresent}
            />
          </div>

          <FieldLabel htmlFor="board-subcircuits">Sub-circuits description</FieldLabel>
          <Textarea id="board-subcircuits" value={draft.subCircuitsDescription ?? ''} onChange={(event) => set('subCircuitsDescription', event.target.value)} />
          <FieldLabel htmlFor="board-comments">Comments</FieldLabel>
          <Textarea id="board-comments" value={draft.comments ?? ''} onChange={(event) => set('comments', event.target.value)} />
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save switchboard'}</Button>
            <Button variant="secondary" onClick={() => requestTreeNavigation(() => router.back(), 'the previous page')} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      </form>

      <ConfirmDialog
        open={confirmMeterRemoval}
        title="Record no installed meter?"
        description="Meters leave the active register and dependent channel mappings become unresolved. Completed forms and evidence remain in history."
        consequences={[
          `${draft.meters.length} metering device${draft.meters.length === 1 ? '' : 's'} will leave the active register`,
          `${forms.filter((item) => item.meterId).length} linked meter form${forms.filter((item) => item.meterId).length === 1 ? '' : 's'} will remain in history`,
          'Affected site-asset mappings will move to To be confirmed',
        ]}
        confirmLabel="Record no meter"
        blockedMessage={tree.installation.status === 'Completed' ? 'Reopen this completed installation before changing metering.' : undefined}
        onConfirm={confirmNoMeter}
        onCancel={() => setConfirmMeterRemoval(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={dependencyPreview.heading}
        description="Deleting this switchboard removes it from the active electrical tree. Completed field records remain in history."
        consequences={dependencyPreview.consequences}
        confirmLabel="Delete switchboard"
        busy={busy}
        blockedMessage={dependencyPreview.blocked ? 'Reopen this completed installation before deleting a switchboard.' : undefined}
        onConfirm={() => void removeBoard()}
        onCancel={() => setConfirmDelete(false)}
      />

      {!saved ? (
        <InlineNotice>Save the switchboard first, then add meter records, evidence, and field forms.</InlineNotice>
      ) : (
        <>
          <Card id="board-relationships" tabIndex={-1} className="mb-5 scroll-mt-4">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Electrical children</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">These relationships follow electrical supply and may cross physical zones.</p>
            </div>
            <div className="mt-4 grid gap-5 xl:grid-cols-2">
              <section aria-labelledby="downstream-switchboards-heading">
                <h3 id="downstream-switchboards-heading" className="text-sm font-extrabold text-[var(--text)]">Downstream switchboards · {downstreamBoards.length}</h3>
                {downstreamBoards.length ? (
                  <div className="mt-2 space-y-2">
                    {downstreamBoards.map((child) => {
                      const childZone = tree.zones.find((item) => item.id === child.zoneId);
                      return (
                        <Link key={child.id} href={`/installhub/installations/${installationId}/zones/${child.zoneId}/boards/${child.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold text-[var(--text)]">{displayCodeValue(child)} — {child.assetName}</span>
                            <span className="block truncate text-xs text-[var(--text-sub)]">{child.assetType} · {childZone?.zoneName || 'Unknown zone'}</span>
                          </span>
                          <Icon name="chevron-right" size={17} className="shrink-0 text-[var(--muted)]" />
                        </Link>
                      );
                    })}
                  </div>
                ) : <p className="mt-2 text-sm text-[var(--text-sub)]">No downstream switchboards.</p>}
              </section>
              <section aria-labelledby="supplied-assets-heading">
                <h3 id="supplied-assets-heading" className="text-sm font-extrabold text-[var(--text)]">Supplied site assets · {suppliedAssets.length}</h3>
                {suppliedAssets.length ? (
                  <div className="mt-2 space-y-2">
                    {suppliedAssets.map((asset) => {
                      const assetZone = tree.zones.find((item) => item.id === asset.zoneId);
                      return (
                        <Link key={asset.id} href={`/installhub/installations/${installationId}/zones/${asset.zoneId}/assets/${asset.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold text-[var(--text)]">{displayCodeValue(asset)} — {asset.assetName}</span>
                            <span className="block truncate text-xs text-[var(--text-sub)]">{asset.assetType} · {assetZone?.zoneName || 'Unknown zone'}</span>
                          </span>
                          <Icon name="chevron-right" size={17} className="shrink-0 text-[var(--muted)]" />
                        </Link>
                      );
                    })}
                  </div>
                ) : <p className="mt-2 text-sm text-[var(--text-sub)]">No site assets use this board as their confirmed supply.</p>}
              </section>
            </div>
          </Card>
          <div className="mb-5 grid gap-5 xl:grid-cols-2">
            <Card id="board-meters" tabIndex={-1} className="scroll-mt-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[var(--text)]">Meters</h2>
                  <p className="mt-1 text-xs text-[var(--text-sub)]">Device identity, channels, verification, and commissioning.</p>
                </div>
                <LinkButton href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/new`}><Icon name="plus" size={16} />Add</LinkButton>
              </div>
              {latest.meters.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No meters installed.</p> : (
                <div className="space-y-2">
                  {latest.meters.map((meter) => (
                    <Link key={meter.id} href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/${meter.id}`} className="flex min-h-12 items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                      <span>
                        <span className="block text-sm font-bold text-[var(--text)]">{meter.deviceName}</span>
                        <span className="block text-xs text-[var(--text-sub)]">{meter.deviceType} · {meter.deviceId || 'No device ID'} · {meter.wwChannels?.length ?? 0} channels</span>
                      </span>
                      <Icon name="chevron-right" size={17} className="text-[var(--muted)]" />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[var(--text)]">Field forms</h2>
                  <p className="mt-1 text-xs text-[var(--text-sub)]">Installation, ACE, and device fault records.</p>
                </div>
                <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&boardId=${boardId}`}><Icon name="plus" size={16} />Start</LinkButton>
              </div>
              {forms.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No forms linked to this board.</p> : (
                <div className="space-y-2">
                  {forms.map((form) => (
                    <Link key={form.id} href={`/installhub/installations/${installationId}/forms/${form.id}`} className="flex min-h-12 items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                      <span>
                        <span className="block text-sm font-bold text-[var(--text)]">{FORM_DEFINITION_BY_TYPE[form.formType]?.shortTitle ?? form.formType}</span>
                        <span className="block text-xs text-[var(--text-sub)]">{form.status} · {form.attachments.length} attachments</span>
                      </span>
                      <Icon name="chevron-right" size={17} className="text-[var(--muted)]" />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <Card id="board-evidence" tabIndex={-1} className="scroll-mt-4">
            <h2 className="font-extrabold text-[var(--text)]">Switchboard evidence</h2>
            <EvidenceField
              label="Main switchboard photo"
              items={latest.photo ? [{ id: 'main', uri: latest.photo }] : []}
              busy={uploading}
              onFiles={uploadMain}
              onRemove={latest.photo ? () => removePhoto('main') : undefined}
            />
            <EvidenceField
              label="Extra photos"
              items={latest.extraPhotos.map((uri, index) => ({ id: `${index}`, uri }))}
              busy={uploading}
              onFiles={uploadExtra}
              onRemove={latest.extraPhotos.length ? (id) => removePhoto('extra', id) : undefined}
            />
          </Card>
        </>
      )}
    </div>
  );
}
