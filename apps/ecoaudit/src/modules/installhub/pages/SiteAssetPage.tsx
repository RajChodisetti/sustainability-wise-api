'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed asset editor from its server query record */

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldError, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, InlineNotice } from '@/modules/installhub/components/InstallHubUi';
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
import { createSiteAsset, nowIso } from '@/modules/installhub/lib/model';
import {
  assetMeterDraftKey,
  parseAssetMeterDraftSnapshot,
  pinSelectedResult,
  shouldClearAssetMeterDraft,
  ASSET_METER_DRAFT_KEY_PREFIX,
  type AssetMeterDraftSnapshot,
} from '@/modules/installhub/lib/electricalPresentation';
import type {
  ElectricalSourceKind,
  MeasurementDirection,
  MeteringStateKind,
  PhaseMode,
  SiteAsset,
} from '@/modules/installhub/types/domain';
import {
  SITE_ASSET_TYPE_OPTIONS,
  applyAssetElectricalSource,
  assetElectricalSource,
  displayCodeMetadata,
  displayCodeValue,
  legacySiteAssetType,
  measurementAssignments,
  meterBoardsForAsset,
  meterDeviceName,
  meterDevices,
  primaryGridSupply,
  setAssetMetering,
  siteAssetMeteringState,
  siteAssetTypeCode,
} from '@/modules/installhub/lib/workflow';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import { useToast } from '@/contexts/ToastContext';

export function InstallHubSiteAssetPage({ mode }: { mode: 'new' | 'edit' }) {
  const { installationId, zoneId, assetId } = useParams<{
    installationId: string;
    zoneId: string;
    assetId?: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<SiteAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [meterBoardSearch, setMeterBoardSearch] = useState('');
  const [meterSearch, setMeterSearch] = useState('');
  const [errors, setErrors] = useState<Array<{ id?: string; message: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingMeteringKind, setPendingMeteringKind] = useState<MeteringStateKind | null>(null);
  const [detourHref, setDetourHref] = useState<string | null>(null);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);
  const [activeResumeDraftKey, setActiveResumeDraftKey] = useState<string | null>(null);
  const initializedEditorRef = useRef<string | null>(null);

  const source = query.data?.siteAssets.find((item) => item.id === assetId);
  useEffect(() => {
    const editorKey = `${installationId}:${zoneId}:${mode}:${assetId || 'new'}`;
    if (initializedEditorRef.current === editorKey) return;
    if (mode === 'edit' && !source) return;

    const params = new URLSearchParams(window.location.search);
    const resumeDraftKey = params.get('resumeDraftKey');
    const createdMeterId = params.get('createdMeterId');
    const stored = resumeDraftKey?.startsWith(ASSET_METER_DRAFT_KEY_PREFIX)
      ? window.sessionStorage.getItem(resumeDraftKey)
      : null;
    const snapshot = parseAssetMeterDraftSnapshot(stored, {
      installationId,
      zoneId,
      mode,
      ...(mode === 'edit' && assetId ? { assetId } : {}),
    });
    if (snapshot) {
      const restored = structuredClone(snapshot.draft);
      restored.meterSwitchboardId = snapshot.meterBoardId;
      if (createdMeterId) {
        restored.meterId = createdMeterId;
        restored.meterChannelIds = [];
        restored.meterChannels = [];
      }
      setDraft(restored);
      setResumeMessage(createdMeterId
        ? 'Device added. Your site asset draft was restored; choose the exact channels to finish the mapping.'
        : 'Your site asset draft was restored.');
      setActiveResumeDraftKey(resumeDraftKey!);
      window.setTimeout(() => document.getElementById('asset-meter')?.focus(), 0);
    } else if (mode === 'new') {
      setDraft(createSiteAsset(installationId, zoneId));
    } else {
      setDraft(structuredClone(source!));
    }
    initializedEditorRef.current = editorKey;
  }, [assetId, installationId, mode, source, zoneId]);

  useEffect(() => {
    if (detourHref) router.push(detourHref);
  }, [detourHref, router]);

  if (query.isLoading || !draft) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (mode === 'edit' && !source) return <ErrorBanner message="Site asset not found." />;
  const tree = query.data!;
  const zone = tree.zones.find((item) => item.id === zoneId);
  if (!zone) return <ErrorBanner message="Zone not found." />;
  const saved = mode === 'edit';
  const currentDraft = draft;
  const forms = tree.formSubmissions.filter((item) => item.siteAssetId === assetId);
  const draftSource = assetElectricalSource(draft);
  const meteringState = siteAssetMeteringState(draft);
  const codeMeta = displayCodeMetadata(
    tree,
    siteAssetTypeCode(draft),
    draft.displayCode || '',
    draft.displayCodeMeta,
    draft.id,
  );
  const normalizedBoardSearch = boardSearch.trim().toLowerCase();
  const allSourceBoards = [...tree.electricalAssets].sort((left, right) => left.id.localeCompare(right.id));
  const matchingSourceBoards = allSourceBoards.filter((board) => {
    const boardZone = tree.zones.find((item) => item.id === board.zoneId);
    return !normalizedBoardSearch || `${displayCodeValue(board)} ${board.assetName} ${boardZone?.zoneName || ''}`.toLowerCase().includes(normalizedBoardSearch);
  });
  const sourceBoards = pinSelectedResult(
    matchingSourceBoards,
    allSourceBoards,
    draftSource.kind === 'BOARD' ? draftSource.boardId : null,
    (item) => item.id,
  );
  const eligibleMeterBoards = meterBoardsForAsset(tree, draft);
  const normalizedMeterBoardSearch = meterBoardSearch.trim().toLowerCase();
  const matchingMeterBoards = eligibleMeterBoards.filter((board) => {
    const boardZone = tree.zones.find((item) => item.id === board.zoneId);
    return !normalizedMeterBoardSearch || `${displayCodeValue(board)} ${board.assetName} ${boardZone?.zoneName || ''}`.toLowerCase().includes(normalizedMeterBoardSearch);
  }).sort((left, right) => left.id.localeCompare(right.id));
  const filteredMeterBoards = pinSelectedResult(matchingMeterBoards, eligibleMeterBoards, draft.meterSwitchboardId, (item) => item.id);
  const eligibleMeters = meterDevices(tree).filter(
    (meter) => meter.lifecycleState !== 'INACTIVE' && (!draft.meterSwitchboardId || meter.installedOnBoardId === draft.meterSwitchboardId),
  ).sort((left, right) => left.id.localeCompare(right.id));
  const normalizedMeterSearch = meterSearch.trim().toLocaleLowerCase('en-AU');
  const matchingMeters = eligibleMeters.filter((meter) => (
    !normalizedMeterSearch
    || `${meterDeviceName(meter)} ${meter.deviceModel} ${meter.serialNumber} ${meter.id}`
      .toLocaleLowerCase('en-AU')
      .includes(normalizedMeterSearch)
  ));
  const availableMeters = pinSelectedResult(matchingMeters, eligibleMeters, draft.meterId, (item) => item.id);
  const selectedMeter = meterDevices(tree).find((meter) => meter.id === draft.meterId);
  const existingAssignment = measurementAssignments(tree).find(
    (assignment) => assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === draft.id,
  );
  const usedChannelOwners = new Map<string, string>();
  for (const assignment of measurementAssignments(tree)) {
    if (assignment.id === existingAssignment?.id) continue;
    for (const channelId of assignment.channelIds) {
      const targetAssetId = assignment.target.kind === 'SITE_ASSET' ? assignment.target.siteAssetId : null;
      const owner = targetAssetId
        ? tree.siteAssets.find((item) => item.id === targetAssetId)?.assetName || 'another asset'
        : 'another measurement target';
      usedChannelOwners.set(channelId, owner);
    }
  }
  const selectedChannelCount = draft.meterChannelIds?.length || 0;
  const selectedPhaseMode = draft.phaseMode || 'SINGLE_PHASE';
  const requiredChannelCount = selectedPhaseMode === 'SINGLE_PHASE'
    ? 1
    : selectedPhaseMode === 'THREE_PHASE'
      ? 3
      : null;
  const channelGroupComplete = requiredChannelCount === null
    ? selectedChannelCount > 0
    : selectedChannelCount === requiredChannelCount;
  const channelGroupAnnouncement = `${selectedPhaseMode.replaceAll('_', ' ').toLowerCase()} requires ${requiredChannelCount ?? 'one or more'} channel${requiredChannelCount === 1 ? '' : 's'}. ${selectedChannelCount} selected. ${channelGroupComplete ? 'Channel group complete.' : 'Channel group incomplete.'}`;
  const hasLocalChanges = mode === 'new'
    || Boolean(source && JSON.stringify(draft) !== JSON.stringify(source));

  function set<K extends keyof SiteAsset>(key: K, value: SiteAsset[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const nextErrors: Array<{ id?: string; message: string }> = [];
    if (!currentDraft.assetName.trim()) nextErrors.push({ id: 'asset-name', message: 'Enter the site asset name.' });
    if (siteAssetTypeCode(currentDraft) === 'OTHER' && !currentDraft.customTypeName?.trim()) {
      nextErrors.push({ id: 'asset-custom-type', message: 'Enter the custom site asset type.' });
    }
    const electricalSource = assetElectricalSource(currentDraft);
    if (electricalSource.kind === 'BOARD' && !electricalSource.boardId) {
      nextErrors.push({ id: 'asset-source-board', message: 'Choose the confirmed supplying switchboard.' });
    }
    const displayCode = displayCodeMetadata(
      tree,
      siteAssetTypeCode(currentDraft),
      currentDraft.displayCode || '',
      currentDraft.displayCodeMeta,
      currentDraft.id,
    ).value;
    if (!displayCode.trim()) nextErrors.push({ id: 'asset-code', message: 'Enter or generate a display code.' });
    const state = siteAssetMeteringState(currentDraft);
    if (state.kind === 'METERED') {
      if (!currentDraft.meterSwitchboardId) nextErrors.push({ id: 'asset-meter-board', message: 'Choose the switchboard where the meter is installed.' });
      if (!currentDraft.meterId) nextErrors.push({ id: 'asset-meter', message: 'Choose the exact metering device.' });
      const channelCount = currentDraft.meterChannelIds?.length || 0;
      if (currentDraft.phaseMode === 'SINGLE_PHASE' && channelCount !== 1) {
        nextErrors.push({ id: 'asset-channels', message: 'Select exactly one channel for single phase.' });
      } else if (currentDraft.phaseMode === 'THREE_PHASE' && channelCount !== 3) {
        nextErrors.push({ id: 'asset-channels', message: 'Select exactly three channels for three phase.' });
      } else if (currentDraft.phaseMode === 'OTHER' && channelCount < 1) {
        nextErrors.push({ id: 'asset-channels', message: 'Select at least one channel for the custom phase grouping.' });
      }
      if ((currentDraft.meterChannelIds || []).some((id) => usedChannelOwners.has(id))) {
        nextErrors.push({ id: 'asset-channels', message: 'One or more channels are already assigned to another target.' });
      }
      if (currentDraft.meterSwitchboardId && !eligibleMeterBoards.some((board) => board.id === currentDraft.meterSwitchboardId)) {
        nextErrors.push({ id: 'asset-meter-board', message: 'Choose a meter on this asset’s confirmed electrical supply path.' });
      }
    }
    setErrors(nextErrors);
    if (nextErrors.length) {
      document.getElementById(nextErrors[0].id || '')?.focus();
      toast.error('Check the highlighted site asset fields.');
      return;
    }
    setBusy(true);
    try {
      await writer.mutate((next) => {
        const value: SiteAsset = {
          ...structuredClone(currentDraft),
          assetName: currentDraft.assetName.trim(),
          assetType: legacySiteAssetType(siteAssetTypeCode(currentDraft)),
          typeCode: siteAssetTypeCode(currentDraft),
          customTypeName: siteAssetTypeCode(currentDraft) === 'OTHER' ? currentDraft.customTypeName?.trim() : null,
          displayCode: displayCode.trim(),
          displayCodeMeta: {
            ...displayCodeMetadata(next, siteAssetTypeCode(currentDraft), displayCode, currentDraft.displayCodeMeta, currentDraft.id),
            value: displayCode.trim(),
          },
          updatedAt: nowIso(),
        };
        applyAssetElectricalSource(value, electricalSource);
        if (state.kind === 'METERED') {
          setAssetMetering(next, value, {
            kind: 'METERED',
            meterId: currentDraft.meterId!,
            channelIds: currentDraft.meterChannelIds || [],
            phaseMode: currentDraft.phaseMode || 'OTHER',
            direction: currentDraft.measurementDirection || 'CONSUMPTION',
          });
        } else {
          setAssetMetering(next, value, { kind: state.kind });
        }
        const index = next.siteAssets.findIndex((item) => item.id === value.id);
        if (index >= 0) next.siteAssets[index] = value;
        else next.siteAssets.push(value);
      });
      if (activeResumeDraftKey && shouldClearAssetMeterDraft('ASSET_SAVE_CONFIRMED')) {
        clearActiveResumeDraft();
        if (saved) {
          try {
            window.history.replaceState(window.history.state, '', window.location.pathname);
          } catch {
            // The saved asset is authoritative even if URL cleanup is blocked.
          }
        }
      }
      setErrors([]);
      toast.success(saved ? 'Site asset saved.' : 'Site asset created.');
      if (!saved) {
        router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/assets/${currentDraft.id}`);
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLocation(files: File[]) {
    const file = files[0];
    if (!file || !assetId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.siteAssets.find((item) => item.id === assetId);
        if (!target) throw new Error('Site asset not found.');
        target.locationPhoto = await uploadInstallationPhoto(next, {
          installationId,
          entityType: 'site_asset',
          entityId: assetId,
          fieldName: 'locationPhoto',
        }, file);
        target.updatedAt = nowIso();
      });
      toast.success('Location photo uploaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function uploadExtra(files: File[]) {
    if (!assetId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.siteAssets.find((item) => item.id === assetId);
        if (!target) throw new Error('Site asset not found.');
        for (const file of files) {
          const index = target.extraPhotos.length;
          target.extraPhotos.push(await uploadInstallationPhoto(next, {
            installationId,
            entityType: 'site_asset',
            entityId: assetId,
            fieldName: `extraPhotos[${index}]`,
          }, file));
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

  async function removePhoto(kind: 'location' | 'extra', id?: string) {
    try {
      await writer.mutate((next) => {
        const target = next.siteAssets.find((item) => item.id === assetId);
        if (!target) return;
        if (kind === 'location') target.locationPhoto = null;
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

  async function removeAsset() {
    if (!assetId) return;
    try {
      await writer.mutate((next) => {
        next.siteAssets = next.siteAssets.filter((item) => item.id !== assetId);
        next.measurementAssignments = (next.measurementAssignments || []).filter(
          (assignment) => assignment.target.kind !== 'SITE_ASSET' || assignment.target.siteAssetId !== assetId,
        );
        next.formSubmissions = next.formSubmissions.map((item) =>
          item.status === 'Draft' && item.siteAssetId === assetId ? { ...item, siteAssetId: null } : item,
        );
      });
      setConfirmDelete(false);
      toast.success('Site asset deleted. Completed form history was retained.');
      router.replace(`/installhub/installations/${installationId}/zones/${zoneId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  function chooseSource(kind: ElectricalSourceKind) {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      if (kind === 'GRID') applyAssetElectricalSource(next, { kind: 'GRID', gridSupplyId: primaryGridSupply(tree).id });
      else if (kind === 'BOARD') applyAssetElectricalSource(next, { kind: 'BOARD', boardId: '' });
      else applyAssetElectricalSource(next, { kind: 'TBC' });
      next.meterSwitchboardId = null;
      next.meterId = null;
      next.meterChannelIds = [];
      if (siteAssetMeteringState(next).kind === 'METERED') {
        next.meteringState = { kind: 'METERED', measurementAssignmentIds: existingAssignment ? [existingAssignment.id] : [] };
      }
      return next;
    });
  }

  function chooseAssetType(value: string) {
    setDraft((current) => {
      if (!current) return current;
      const generated = displayCodeMetadata(
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
        assetType: legacySiteAssetType(value),
        customTypeName: value === 'OTHER' ? current.customTypeName : null,
        displayCode: current.displayCodeMeta?.isOverridden ? current.displayCode : generated.value,
        displayCodeMeta: current.displayCodeMeta?.isOverridden
          ? { ...current.displayCodeMeta, generatedValue: generated.generatedValue }
          : generated,
      };
    });
  }

  function setCodeOverride(checked: boolean) {
    setDraft((current) => {
      if (!current) return current;
      const generated = displayCodeMetadata(tree, siteAssetTypeCode(current), '', undefined, current.id);
      return {
        ...current,
        displayCode: checked ? displayCodeValue(current) : generated.value,
        displayCodeMeta: {
          ...generated,
          value: checked ? displayCodeValue(current) : generated.value,
          isOverridden: checked,
        },
      };
    });
  }

  function applyMeteringChoice(kind: MeteringStateKind) {
    setDraft((current) => {
      if (!current) return current;
      if (kind === 'METERED') return {
        ...current,
        meterPresent: true,
        meteringState: { kind: 'METERED', measurementAssignmentIds: existingAssignment ? [existingAssignment.id] : [] },
        phaseMode: current.phaseMode || 'SINGLE_PHASE',
        measurementDirection: current.measurementDirection || 'CONSUMPTION',
        meterSwitchboardTbc: false,
      };
      return {
        ...current,
        meterPresent: false,
        meteringState: { kind },
        meterSwitchboardId: null,
        meterSwitchboardTbc: kind === 'TBC',
        meterId: null,
        meterChannelIds: [],
        meterChannels: [],
        phaseMode: null,
        measurementDirection: null,
      };
    });
  }

  function chooseMetering(kind: MeteringStateKind) {
    if (
      meteringState.kind === 'METERED'
      && kind !== 'METERED'
      && (Boolean(existingAssignment) || Boolean(currentDraft.meterId) || Boolean(currentDraft.meterChannelIds?.length))
    ) {
      setPendingMeteringKind(kind);
      return;
    }
    applyMeteringChoice(kind);
  }

  function chooseMeterBoard(boardId: string) {
    setDraft((current) => current ? {
      ...current,
      meterSwitchboardId: boardId || null,
      meterSwitchboardTbc: false,
      meterId: null,
      meterChannelIds: [],
      meterChannels: [],
    } : current);
  }

  function chooseMeter(meterId: string) {
    setDraft((current) => current ? {
      ...current,
      meterId: meterId || null,
      meterChannelIds: [],
      meterChannels: [],
    } : current);
  }

  function addDeviceToMeterBoard() {
    const meterBoardId = currentDraft.meterSwitchboardId;
    const meterBoard = tree.electricalAssets.find((item) => item.id === meterBoardId);
    if (!meterBoardId || !meterBoard) {
      toast.error('Choose the switchboard where the device will be installed first.');
      return;
    }
    const resumeDraftKey = activeResumeDraftKey || assetMeterDraftKey(installationId, currentDraft.id);
    const snapshot: AssetMeterDraftSnapshot = {
      version: 1,
      installationId,
      zoneId,
      mode,
      assetId: currentDraft.id,
      meterBoardId,
      capturedAt: new Date().toISOString(),
      draft: structuredClone(currentDraft),
    };
    try {
      window.sessionStorage.setItem(resumeDraftKey, JSON.stringify(snapshot));
    } catch {
      toast.error('The site asset draft could not be held for the device detour. Save the asset and try again.');
      return;
    }
    const params = new URLSearchParams({
      returnAssetMode: mode,
      returnAssetZoneId: zoneId,
      returnAssetId: currentDraft.id,
      resumeDraftKey,
    });
    setDetourHref(`/installhub/installations/${encodeURIComponent(installationId)}/zones/${encodeURIComponent(meterBoard.zoneId)}/boards/${encodeURIComponent(meterBoard.id)}/meters/new?${params.toString()}`);
  }

  function clearActiveResumeDraft() {
    if (!activeResumeDraftKey) return;
    try {
      window.sessionStorage.removeItem(activeResumeDraftKey);
    } catch {
      // A confirmed write/discard must not be reported as failed because the
      // browser refused best-effort cleanup of recovery-only storage.
    }
    setActiveResumeDraftKey(null);
  }

  function toggleChannel(channelId: string, checked: boolean) {
    setDraft((current) => {
      if (!current) return current;
      const ids = new Set(current.meterChannelIds || []);
      if (checked) ids.add(channelId);
      else ids.delete(channelId);
      return { ...current, meterChannelIds: [...ids] };
    });
  }

  const latest = query.data!.siteAssets.find((item) => item.id === assetId) ?? draft;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: zone.zoneName, href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: mode === 'new' ? 'New site asset' : draft.assetName || 'Site asset' },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'New site asset' : draft.assetName || 'Site asset'}
        subtitle="Equipment identity, electrical and metering relationships, channels, and evidence."
        actions={saved ? (
          <>
            <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&siteAssetId=${assetId}`}>
              <Icon name="clipboard" size={17} />New field form
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

      {resumeMessage ? <div className="mb-5"><InlineNotice tone="success">{resumeMessage}</InlineNotice></div> : null}

      <TreeDraftNavigationGuard
        active={!detourHref && !busy && !uploading && (hasLocalChanges || writer.hasPendingTree || Boolean(activeResumeDraftKey))}
        onDiscard={async () => {
          if (activeResumeDraftKey && shouldClearAssetMeterDraft('EXPLICIT_DISCARD')) {
            clearActiveResumeDraft();
          }
          await writer.discard();
        }}
      />
      <ErrorSummary errors={errors} />

      <form onSubmit={(event) => void save(event)}>
        <Card className="mb-5">
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="asset-name">Asset name *</FieldLabel>
              <Input
                id="asset-name"
                required
                value={draft.assetName}
                aria-invalid={errors.some((item) => item.id === 'asset-name')}
                aria-describedby={errors.some((item) => item.id === 'asset-name') ? 'asset-name-error' : undefined}
                onChange={(event) => set('assetName', event.target.value)}
              />
              <FieldError id="asset-name-error" message={errors.find((item) => item.id === 'asset-name')?.message} />
            </div>
            <div>
              <FieldLabel htmlFor="asset-type">Asset type *</FieldLabel>
              <Select id="asset-type" value={siteAssetTypeCode(draft)} onChange={(event) => chooseAssetType(event.target.value)}>
                {SITE_ASSET_TYPE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
              </Select>
            </div>
            {siteAssetTypeCode(draft) === 'OTHER' ? (
              <div>
                <FieldLabel htmlFor="asset-custom-type">Custom asset type *</FieldLabel>
                <Input
                  id="asset-custom-type"
                  value={draft.customTypeName ?? ''}
                  aria-invalid={errors.some((item) => item.id === 'asset-custom-type')}
                  aria-describedby={errors.some((item) => item.id === 'asset-custom-type') ? 'asset-custom-type-error' : undefined}
                  onChange={(event) => set('customTypeName', event.target.value)}
                />
                <FieldError id="asset-custom-type-error" message={errors.find((item) => item.id === 'asset-custom-type')?.message} />
              </div>
            ) : null}
            <div>
              <FieldLabel htmlFor="asset-code">Display code *</FieldLabel>
              <Input
                id="asset-code"
                required
                value={codeMeta.value}
                readOnly={!codeMeta.isOverridden}
                aria-invalid={errors.some((item) => item.id === 'asset-code')}
                aria-describedby="asset-code-hint"
                onChange={(event) => setDraft((current) => current ? {
                  ...current,
                  displayCode: event.target.value,
                  displayCodeMeta: { ...codeMeta, value: event.target.value, isOverridden: true },
                } : current)}
              />
              <FieldHint id="asset-code-hint">Generated from site and asset type unless deliberately overridden.</FieldHint>
              <FieldError message={errors.find((item) => item.id === 'asset-code')?.message} />
              <Checkbox label="Use a custom display code" checked={codeMeta.isOverridden} onChange={setCodeOverride} />
            </div>
            <div>
              <FieldLabel htmlFor="asset-location">Location description</FieldLabel>
              <Input id="asset-location" value={draft.locationDescription ?? ''} onChange={(event) => set('locationDescription', event.target.value)} />
            </div>
          </div>

          <div id="asset-supply" tabIndex={-1} className="mt-6 border-t border-[var(--border)] pt-2">
            <ChoiceGroup<ElectricalSourceKind>
              label="What supplies this asset?"
              hint="This electrical relationship may cross physical zones."
              value={draftSource.kind}
              options={[
                { value: 'GRID', label: 'Grid', description: primaryGridSupply(tree).name },
                { value: 'BOARD', label: 'Switchboard', description: 'Choose from every switchboard already captured.' },
                { value: 'TBC', label: 'To be confirmed', description: 'Reconcile this relationship before completion.' },
              ]}
              onChange={chooseSource}
            />
            {draftSource.kind === 'GRID' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <FieldLabel htmlFor="asset-grid-supply" className="mt-0">Grid supply *</FieldLabel>
                <Select
                  id="asset-grid-supply"
                  value={draftSource.gridSupplyId}
                  onChange={(event) => setDraft((current) => {
                    if (!current) return current;
                    const next = structuredClone(current);
                    applyAssetElectricalSource(next, { kind: 'GRID', gridSupplyId: event.target.value });
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
            {draftSource.kind === 'BOARD' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <FieldLabel htmlFor="asset-source-search" className="mt-0">Find a supplying switchboard</FieldLabel>
                <Input id="asset-source-search" type="search" value={boardSearch} placeholder="Search code, name, or zone" onChange={(event) => setBoardSearch(event.target.value)} />
                <FieldLabel htmlFor="asset-source-board">Confirmed supplying switchboard *</FieldLabel>
                <Select
                  id="asset-source-board"
                  value={draftSource.boardId}
                  aria-invalid={errors.some((item) => item.id === 'asset-source-board')}
                  onChange={(event) => setDraft((current) => {
                    if (!current) return current;
                    const next = structuredClone(current);
                    applyAssetElectricalSource(next, { kind: 'BOARD', boardId: event.target.value });
                    next.meterSwitchboardId = null;
                    next.meterId = null;
                    next.meterChannelIds = [];
                    return next;
                  })}
                >
                  <option value="">Choose a switchboard</option>
                  {sourceBoards.map((board) => {
                    const boardZone = tree.zones.find((item) => item.id === board.zoneId);
                    return <option key={board.id} value={board.id}>{displayCodeValue(board)} — {board.assetName} · {boardZone?.zoneName || 'Unknown zone'}</option>;
                  })}
                </Select>
                <FieldError message={errors.find((item) => item.id === 'asset-source-board')?.message} />
              </div>
            ) : null}
            {draftSource.kind === 'TBC' ? <InlineNotice>Unresolved supply will appear in reconciliation and block completion.</InlineNotice> : null}
          </div>

          <div id="asset-metering" tabIndex={-1} className="mt-6 border-t border-[var(--border)] pt-2">
            <ChoiceGroup<MeteringStateKind>
              label="How is this asset measured?"
              hint="Do not infer metering from missing fields; record the observed state explicitly."
              value={meteringState.kind}
              options={[
                { value: 'METERED', label: 'Metered', description: 'Map an exact device and channel group.' },
                { value: 'UNMETERED', label: 'Unmetered', description: 'Confirmed: no direct metering is installed.' },
                { value: 'TBC', label: 'To be confirmed', description: 'The metering relationship is not yet known.' },
              ]}
              onChange={chooseMetering}
            />

            {meteringState.kind === 'METERED' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <FieldLabel htmlFor="asset-meter-board-search" className="mt-0">Find a meter switchboard</FieldLabel>
                <Input id="asset-meter-board-search" type="search" value={meterBoardSearch} placeholder="Search the confirmed supply path" onChange={(event) => setMeterBoardSearch(event.target.value)} />
                <FieldLabel htmlFor="asset-meter-board">Switchboard where the meter is installed *</FieldLabel>
                <Select
                  id="asset-meter-board"
                  value={draft.meterSwitchboardId ?? ''}
                  aria-invalid={errors.some((item) => item.id === 'asset-meter-board')}
                  onChange={(event) => chooseMeterBoard(event.target.value)}
                >
                  <option value="">Choose a switchboard</option>
                  {filteredMeterBoards.map((board) => {
                    const boardZone = tree.zones.find((item) => item.id === board.zoneId);
                    return <option key={board.id} value={board.id}>{displayCodeValue(board)} — {board.assetName} · {boardZone?.zoneName || 'Unknown zone'}</option>;
                  })}
                </Select>
                <FieldError message={errors.find((item) => item.id === 'asset-meter-board')?.message} />

                <FieldLabel htmlFor="asset-meter-search">Find an exact metering device</FieldLabel>
                <Input
                  id="asset-meter-search"
                  type="search"
                  value={meterSearch}
                  disabled={!draft.meterSwitchboardId}
                  placeholder="Search name, model, serial, or stable ID"
                  onChange={(event) => setMeterSearch(event.target.value)}
                />
                <FieldLabel htmlFor="asset-meter">Exact metering device *</FieldLabel>
                <Select
                  id="asset-meter"
                  value={draft.meterId ?? ''}
                  disabled={!draft.meterSwitchboardId}
                  aria-invalid={errors.some((item) => item.id === 'asset-meter')}
                  onChange={(event) => chooseMeter(event.target.value)}
                >
                  <option value="">Choose a device</option>
                  {availableMeters.map((meter) => <option key={meter.id} value={meter.id}>{meterDeviceName(meter)} · {meter.deviceModel} · {meter.serialNumber || 'No serial'}</option>)}
                </Select>
                <FieldError message={errors.find((item) => item.id === 'asset-meter')?.message} />
                <FieldHint>Showing {availableMeters.length} of {eligibleMeters.length} eligible devices. Refine the search to reach any device; the current selection remains visible.</FieldHint>
                {draft.meterSwitchboardId && availableMeters.length === 0 ? (
                  <FieldHint>No active metering devices are installed on this switchboard.</FieldHint>
                ) : null}
                {draft.meterSwitchboardId ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button variant="secondary" disabled={Boolean(detourHref) || busy} onClick={addDeviceToMeterBoard}>
                      <Icon name="plus" size={16} />{detourHref ? 'Opening device editor…' : 'Add device to this board'}
                    </Button>
                    <p className="text-xs leading-5 text-[var(--text-sub)]">Your current asset draft will be restored here after the device is saved.</p>
                  </div>
                ) : null}

                <ChoiceGroup<PhaseMode>
                  label="Phase grouping"
                  value={draft.phaseMode || 'SINGLE_PHASE'}
                  options={[
                    { value: 'SINGLE_PHASE', label: 'Single phase', description: 'Select exactly one channel.' },
                    { value: 'THREE_PHASE', label: 'Three phase', description: 'Select exactly three channels.' },
                    { value: 'OTHER', label: 'Other grouping', description: 'Select the observed channel group.' },
                  ]}
                  onChange={(value) => {
                    set('phaseMode', value);
                    set('meterChannelIds', []);
                  }}
                />

                <ChoiceGroup<MeasurementDirection>
                  label="Measurement direction"
                  value={draft.measurementDirection || 'CONSUMPTION'}
                  options={[
                    { value: 'CONSUMPTION', label: 'Consumption', description: 'Load consumes energy.' },
                    { value: 'GENERATION', label: 'Generation', description: 'Source exports generated energy.' },
                    { value: 'BIDIRECTIONAL', label: 'Bidirectional', description: 'Flow may occur in both directions.' },
                  ]}
                  onChange={(value) => set('measurementDirection', value)}
                />

                <fieldset id="asset-channels" className="mt-5" tabIndex={-1} aria-describedby="asset-channel-group-status">
                  <legend className="text-sm font-bold text-[var(--text)]">Measured channels *</legend>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Only non-spare channels on the selected device can be assigned.</p>
                  <p id="asset-channel-group-status" className="mt-1 text-xs font-semibold text-[var(--text-sub)]" role="status" aria-live="polite" aria-atomic="true">{channelGroupAnnouncement}</p>
                  {!selectedMeter ? <p className="mt-3 text-sm text-[var(--text-sub)]">Choose a device to see its channels.</p> : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {selectedMeter.channels.map((channel) => {
                        const owner = usedChannelOwners.get(channel.id);
                        const unavailable = channel.purpose === 'SPARE' || Boolean(owner);
                        const unavailableReasonId = unavailable ? `asset-channel-${channel.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}-reason` : undefined;
                        return (
                          <div key={channel.id} className={`rounded-xl border px-3 py-2 ${unavailable ? 'border-[var(--border)] bg-[var(--surface)] opacity-65' : 'border-[var(--border-strong)] bg-[var(--surface)]'}`}>
                            <Checkbox
                              label={`Channel ${channel.ordinal} — ${channel.description || channel.loadTypeCode || channel.purpose.replaceAll('_', ' ').toLowerCase()}`}
                              checked={(draft.meterChannelIds || []).includes(channel.id)}
                              disabled={unavailable}
                              ariaDescribedBy={unavailableReasonId}
                              onChange={(checked) => toggleChannel(channel.id, checked)}
                            />
                            {unavailable ? <p id={unavailableReasonId} className="pl-8 text-xs font-semibold text-[var(--amber)]">Unavailable: {channel.purpose === 'SPARE' ? 'marked spare on the device' : `already assigned to ${owner}`}.</p> : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <FieldError message={errors.find((item) => item.id === 'asset-channels')?.message} />
                </fieldset>
              </div>
            ) : null}
            {meteringState.kind === 'UNMETERED' ? <InlineNotice>This asset is intentionally retained in the full asset register without a direct channel assignment.</InlineNotice> : null}
            {meteringState.kind === 'TBC' ? <InlineNotice>Unresolved metering will appear in reconciliation and block completion.</InlineNotice> : null}
          </div>

          <FieldLabel htmlFor="asset-comments">Comments</FieldLabel>
          <Textarea id="asset-comments" value={draft.comments ?? ''} onChange={(event) => set('comments', event.target.value)} />
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save site asset'}</Button>
            <Button variant="secondary" onClick={() => requestTreeNavigation(() => router.back(), 'the previous page')} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      </form>

      <ConfirmDialog
        open={Boolean(pendingMeteringKind)}
        title={`Change metering to ${pendingMeteringKind === 'UNMETERED' ? 'Unmetered' : 'To be confirmed'}?`}
        description="The exact active meter and channel relationship will be removed from this asset."
        consequences={[
          `${draft.meterChannelIds?.length || existingAssignment?.channelIds.length || 0} assigned channel${(draft.meterChannelIds?.length || existingAssignment?.channelIds.length || 0) === 1 ? '' : 's'} will be released`,
          draft.meterId ? `Meter ${draft.meterId} will remain in the active device register` : 'The metering device remains unchanged',
          pendingMeteringKind === 'TBC' ? 'The unresolved metering state will block completion' : 'The asset will remain in full coverage as confirmed unmetered',
        ]}
        confirmLabel="Change metering"
        blockedMessage={tree.installation.status === 'Completed' ? 'Reopen this completed installation before changing metering.' : undefined}
        onConfirm={() => {
          if (pendingMeteringKind) applyMeteringChoice(pendingMeteringKind);
          setPendingMeteringKind(null);
        }}
        onCancel={() => setPendingMeteringKind(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${draft.assetName || 'this site asset'}?`}
        description="The site asset and its active measurement assignment will be removed. Completed field records remain in history."
        consequences={[
          `${existingAssignment ? 1 : 0} channel assignment${existingAssignment ? '' : 's'} will be removed`,
          `${forms.length} linked form${forms.length === 1 ? '' : 's'} will remain in history`,
        ]}
        confirmLabel="Delete site asset"
        blockedMessage={tree.installation.status === 'Completed' ? 'Reopen this completed installation before deleting a site asset.' : undefined}
        onConfirm={() => void removeAsset()}
        onCancel={() => setConfirmDelete(false)}
      />

      {!saved ? (
        <InlineNotice>Save the site asset first, then add evidence and water/logger field forms.</InlineNotice>
      ) : (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-extrabold text-[var(--text)]">Field forms</h2>
                <p className="mt-1 text-xs text-[var(--text-sub)]">Honeywell, Captis, and SUMS installation records.</p>
              </div>
              <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&siteAssetId=${assetId}`}><Icon name="plus" size={16} />Start form</LinkButton>
            </div>
            {forms.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No forms linked to this asset.</p> : (
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
          <Card id="asset-evidence">
            <h2 className="font-extrabold text-[var(--text)]">Site asset evidence</h2>
            <EvidenceField
              label="Location photo"
              items={latest.locationPhoto ? [{ id: 'location', uri: latest.locationPhoto }] : []}
              busy={uploading}
              onFiles={uploadLocation}
              onRemove={latest.locationPhoto ? () => removePhoto('location') : undefined}
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
