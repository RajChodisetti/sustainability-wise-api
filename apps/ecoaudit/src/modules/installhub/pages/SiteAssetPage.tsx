'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed asset editor from its server query record */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, InlineNotice, RecordNavigation } from '@/modules/installhub/components/InstallHubUi';
import { SearchableSelect } from '@/modules/installhub/components/SearchableSelect';
import {
  ChoiceGroup,
  ConfirmDialog,
  SaveStateNotice,
  TreeDraftNavigationGuard,
  requestTreeNavigation,
} from '@/modules/installhub/components/WorkflowUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { uploadInstallationPhoto } from '@/modules/installhub/api/installhub';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import { createBoard, createSiteAsset, nowIso } from '@/modules/installhub/lib/model';
import {
  assetMeterDraftKey,
  measurementTargetDetails,
  parseAssetMeterDraftSnapshot,
  pinSelectedResult,
  shouldClearAssetMeterDraft,
  ASSET_METER_DRAFT_KEY_PREFIX,
  type AssetMeterDraftSnapshot,
} from '@/modules/installhub/lib/electricalPresentation';
import type {
  ElectricalSource,
  ElectricalSourceKind,
  ElectricalAsset,
  InstallationTree,
  MeasurementDirection,
  MeteringStateKind,
  MeasurementAssignment,
  PhaseMode,
  SiteAsset,
} from '@/modules/installhub/types/domain';
import {
  defaultCustomNameForType,
  ENTITY_NAME_MAX_LENGTH,
  generatedDisplayCodeV3,
  nameAfterTypeChange,
  provisionalDisplayCodeV3,
} from '@/modules/installhub/lib/naming';
import {
  BOARD_TYPE_OPTIONS,
  SITE_ASSET_TYPE_OPTIONS,
  activeMetersOnAssetSupplyingBoard,
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  assetElectricalSource,
  boardTypeLabel,
  legacyBoardType,
  legacySiteAssetType,
  measurementAssignments,
  meterDeviceName,
  meterDevices,
  primaryGridSupply,
  setAssetMetering,
  siteAssetMeteringState,
  siteAssetTypeCode,
} from '@/modules/installhub/lib/workflow';
import { useToast } from '@/contexts/ToastContext';
import { humanDeviceName } from '@/modules/installhub/lib/deviceSearch';

function defaultBoardName(typeCode: string, customTypeName?: string | null): string {
  return defaultCustomNameForType(
    BOARD_TYPE_OPTIONS,
    typeCode,
    customTypeName,
  );
}

function defaultSiteAssetName(typeCode: string, customTypeName?: string | null): string {
  return defaultCustomNameForType(
    SITE_ASSET_TYPE_OPTIONS,
    typeCode,
    customTypeName,
  );
}

function boardDisplayMetadata(
  tree: InstallationTree,
  board: ElectricalAsset,
) {
  const typeCode = board.typeCode || board.assetType;
  return provisionalDisplayCodeV3(tree, {
    zoneId: board.zoneId,
    customName: board.assetName,
    fallbackType: defaultBoardName(typeCode, board.customTypeName),
    entityKind: 'board',
    entityTypeCode: typeCode,
    excludeId: board.id,
    current: board.displayCodeMeta,
  });
}

function siteAssetDisplayMetadata(
  tree: InstallationTree,
  asset: SiteAsset,
  customName = asset.assetName,
  typeCode = siteAssetTypeCode(asset),
) {
  return provisionalDisplayCodeV3(tree, {
    zoneId: asset.zoneId,
    customName,
    fallbackType: defaultSiteAssetName(typeCode, asset.customTypeName),
    entityKind: 'site_asset',
    entityTypeCode: typeCode,
    excludeId: asset.id,
    current: asset.displayCodeMeta,
  });
}

function sameAssetMeterMapping(left: SiteAsset, right: SiteAsset): boolean {
  const projection = (asset: SiteAsset) => ({
    source: assetElectricalSource(asset),
    meteringKind: siteAssetMeteringState(asset).kind,
    meterSwitchboardId: asset.meterSwitchboardId ?? null,
    meterSwitchboardTbc: asset.meterSwitchboardTbc,
    meterId: asset.meterId ?? null,
    meterChannelIds: asset.meterChannelIds || [],
    meterChannels: asset.meterChannels || [],
    phaseMode: asset.phaseMode ?? null,
    measurementDirection: asset.measurementDirection ?? null,
  });
  return JSON.stringify(projection(left)) === JSON.stringify(projection(right));
}

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingMeteringKind, setPendingMeteringKind] = useState<'UNMETERED' | 'TBC' | null>(null);
  const [pendingChannelTakeover, setPendingChannelTakeover] = useState<{
    assignment: MeasurementAssignment;
    channelId: string;
  } | null>(null);
  const [approvedTakeoverAssignmentIds, setApprovedTakeoverAssignmentIds] = useState<Set<string>>(new Set());
  const [quickBoardOpen, setQuickBoardOpen] = useState(false);
  const [quickBoardName, setQuickBoardName] = useState(defaultBoardName('DB'));
  const [quickBoardType, setQuickBoardType] = useState('DB');
  const [quickBoardCustomType, setQuickBoardCustomType] = useState('');
  const [quickBoardBusy, setQuickBoardBusy] = useState(false);
  const [detourHref, setDetourHref] = useState<string | null>(null);
  const [detourBusy, setDetourBusy] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);
  const [activeResumeDraftKey, setActiveResumeDraftKey] = useState<string | null>(null);
  const initializedEditorRef = useRef<string | null>(null);

  const source = query.data?.siteAssets.find((item) => item.id === assetId);
  useEffect(() => {
    const editorKey = `${installationId}:${zoneId}:${mode}:${assetId || 'new'}`;
    if (initializedEditorRef.current === editorKey) return;
    if (mode === 'edit' && !source) return;
    if (!query.data) return;

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
      const created = createSiteAsset(installationId, zoneId);
      created.assetName = defaultSiteAssetName(siteAssetTypeCode(created));
      created.displayCodeMeta = siteAssetDisplayMetadata(query.data, created);
      created.displayCode = created.displayCodeMeta.value;
      setDraft(created);
    } else {
      setDraft(structuredClone(source!));
    }
    initializedEditorRef.current = editorKey;
  }, [assetId, installationId, mode, query.data, source, zoneId]);

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
  const allSourceBoards = [...tree.electricalAssets].sort((left, right) => left.id.localeCompare(right.id));
  const sourceBoards = pinSelectedResult(
    allSourceBoards,
    allSourceBoards,
    draftSource.kind === 'BOARD' ? draftSource.boardId : null,
    (item) => item.id,
  );
  const selectedSupplyBoard = draftSource.kind === 'BOARD'
    ? tree.electricalAssets.find((board) => board.id === draftSource.boardId)
    : undefined;
  const directSupplyBoardId = selectedSupplyBoard?.id ?? null;
  const eligibleMeters = activeMetersOnAssetSupplyingBoard(tree, draft)
    .sort((left, right) => left.id.localeCompare(right.id));
  const meterOptions = eligibleMeters.map((meter) => ({
    value: meter.id,
    label: `${meter.serialNumber || 'No device ID'} · ${humanDeviceName(meter)}`,
    keywords: `${meterDeviceName(meter)} ${meter.deviceModel} ${meter.displayName.value} ${meter.id}`,
  }));
  const linkedMeter = meterDevices(tree).find((meter) => meter.id === draft.meterId);
  const linkedMeterBoard = tree.electricalAssets.find(
    (board) => board.id === (linkedMeter?.installedOnBoardId || draft.meterSwitchboardId),
  );
  const formSelectedMeter = eligibleMeters.find((meter) => meter.id === draft.meterId);
  const unavailableLinkedMeter = Boolean(draft.meterId && !formSelectedMeter);
  const preserveUnavailableMeterMapping = Boolean(
    source
    && unavailableLinkedMeter
    && sameAssetMeterMapping(source, draft),
  );
  const selectedChannels = linkedMeter && linkedMeterBoard
    ? linkedMeter.channels
      .filter((channel) => (draft.meterChannelIds || []).includes(channel.id))
      .sort((left, right) => left.ordinal - right.ordinal)
    : [];
  const existingAssignment = measurementAssignments(tree).find(
    (assignment) => assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === draft.id,
  );
  const usedChannelAssignments = new Map<string, MeasurementAssignment>();
  for (const assignment of measurementAssignments(tree)) {
    if (assignment.id === existingAssignment?.id) continue;
    for (const channelId of assignment.channelIds) {
      usedChannelAssignments.set(channelId, assignment);
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
  const channelGroupAnnouncement = `A confirmed ${selectedPhaseMode.replaceAll('_', ' ').toLowerCase()} mapping uses ${requiredChannelCount ?? 'one or more'} channel${requiredChannelCount === 1 ? '' : 's'}. ${selectedChannelCount} selected. ${channelGroupComplete ? 'Channel group complete.' : 'Incomplete selections are saved as TBC.'}`;
  const hasLocalChanges = mode === 'new'
    || Boolean(source && JSON.stringify(draft) !== JSON.stringify(source));

  function set<K extends keyof SiteAsset>(key: K, value: SiteAsset[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function setAssetName(value: string) {
    setDraft((current) => {
      if (!current) return current;
      const display = siteAssetDisplayMetadata(tree, current, value);
      return {
        ...current,
        assetName: value,
        displayCode: display.value,
        displayCodeMeta: display,
      };
    });
  }

  function setAssetCustomType(value: string) {
    setDraft((current) => {
      if (!current) return current;
      const nextName = nameAfterTypeChange(
        current.assetName,
        defaultSiteAssetName('OTHER', current.customTypeName),
        defaultSiteAssetName('OTHER', value),
      );
      const next = { ...current, customTypeName: value, assetName: nextName };
      const display = siteAssetDisplayMetadata(tree, next, nextName, 'OTHER');
      return { ...next, displayCode: display.value, displayCodeMeta: display };
    });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const electricalSource = assetElectricalSource(currentDraft);
    const normalizedElectricalSource: ElectricalSource = (
      electricalSource.kind === 'BOARD'
      && !tree.electricalAssets.some((board) => board.id === electricalSource.boardId)
    ) || (
      electricalSource.kind === 'GRID'
      && !(tree.gridSupplies || []).some((supply) => supply.id === electricalSource.gridSupplyId)
    )
      ? { kind: 'TBC' }
      : electricalSource;
    const state = siteAssetMeteringState(currentDraft);
    const selectedChannelIds = currentDraft.meterChannelIds || [];
    const uniqueChannelIds = [...new Set(selectedChannelIds)];
    const phaseMode = currentDraft.phaseMode || 'OTHER';
    const expectedChannelCount = phaseMode === 'SINGLE_PHASE'
      ? 1
      : phaseMode === 'THREE_PHASE'
        ? 3
        : uniqueChannelIds.length;
    const selectedConflicts = [...new Set(selectedChannelIds
      .map((id) => usedChannelAssignments.get(id))
      .filter((assignment): assignment is MeasurementAssignment => Boolean(assignment)))];
    const blockedConflict = selectedConflicts.some((assignment) => (
      assignment.target.kind !== 'TBC'
      && !(assignment.target.kind === 'SITE_ASSET' && approvedTakeoverAssignmentIds.has(assignment.id))
    ));
    const structurallyConfirmedMetering = Boolean(
      state.kind === 'METERED'
      && formSelectedMeter
      && normalizedElectricalSource.kind === 'BOARD'
      && formSelectedMeter.installedOnBoardId === normalizedElectricalSource.boardId
      && expectedChannelCount > 0
      && uniqueChannelIds.length === selectedChannelIds.length
      && uniqueChannelIds.length === expectedChannelCount
      && uniqueChannelIds.every((channelId) => (
        formSelectedMeter.channels.find((channel) => channel.id === channelId)?.purpose === 'SUB_CIRCUIT'
      ))
      && !blockedConflict
    );
    const unresolvedOnSave = normalizedElectricalSource.kind === 'TBC'
      || state.kind === 'TBC'
      || (state.kind === 'METERED' && !preserveUnavailableMeterMapping && !structurallyConfirmedMetering);
    setBusy(true);
    try {
      await writer.mutate((next) => {
        const normalizedAssetName = currentDraft.assetName.trim()
          || defaultSiteAssetName(siteAssetTypeCode(currentDraft), currentDraft.customTypeName);
        const display = siteAssetDisplayMetadata(
          next,
          currentDraft,
          normalizedAssetName,
        );
        const value: SiteAsset = {
          ...structuredClone(currentDraft),
          assetName: normalizedAssetName,
          assetType: legacySiteAssetType(siteAssetTypeCode(currentDraft)),
          typeCode: siteAssetTypeCode(currentDraft),
          customTypeName: siteAssetTypeCode(currentDraft) === 'OTHER'
            ? currentDraft.customTypeName?.trim() || null
            : null,
          displayCode: display.value,
          displayCodeMeta: display,
          updatedAt: nowIso(),
        };
        applyAssetElectricalSource(value, normalizedElectricalSource);
        if (state.kind === 'METERED' && preserveUnavailableMeterMapping) {
          // Historical cross-board/inactive mappings remain authoritative until
          // the user deliberately replaces them with an eligible local meter.
        } else if (state.kind === 'METERED' && structurallyConfirmedMetering && formSelectedMeter) {
          const takeoverAssignmentIds = [...new Set((currentDraft.meterChannelIds || [])
            .map((channelId) => usedChannelAssignments.get(channelId))
            .filter((assignment): assignment is MeasurementAssignment => (
              assignment?.target.kind === 'SITE_ASSET'
              && approvedTakeoverAssignmentIds.has(assignment.id)
            ))
            .map((assignment) => assignment.id))];
          setAssetMetering(next, value, {
            kind: 'METERED',
            meterId: formSelectedMeter.id,
            channelIds: uniqueChannelIds,
            phaseMode,
            direction: currentDraft.measurementDirection || 'CONSUMPTION',
          }, takeoverAssignmentIds.length ? {
            takeoverApproval: { assignmentIds: takeoverAssignmentIds },
          } : undefined);
        } else {
          setAssetMetering(next, value, { kind: state.kind === 'UNMETERED' ? 'UNMETERED' : 'TBC' });
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
      toast.success(unresolvedOnSave
        ? `${saved ? 'Site asset saved' : 'Site asset created'} with unresolved relationships kept as TBC.`
        : saved ? 'Site asset saved.' : 'Site asset created.');
      router.replace(`/installhub/installations/${installationId}/zones/${zoneId}`);
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
      const nextName = nameAfterTypeChange(
        current.assetName,
        defaultSiteAssetName(siteAssetTypeCode(current), current.customTypeName),
        defaultSiteAssetName(value, value === 'OTHER' ? current.customTypeName : null),
      );
      const next = {
        ...current,
        assetName: nextName,
        typeCode: value,
        assetType: legacySiteAssetType(value),
        customTypeName: value === 'OTHER' ? current.customTypeName : null,
      };
      const display = siteAssetDisplayMetadata(tree, next, nextName, value);
      return { ...next, displayCode: display.value, displayCodeMeta: display };
    });
  }

  function applyMeteringChoice(kind: MeteringStateKind) {
    setDraft((current) => {
      if (!current) return current;
      if (kind === 'METERED') {
        const source = assetElectricalSource(current);
        const currentMeter = meterDevices(tree).find((meter) => meter.id === current.meterId);
        const directSupplyBoardId = source.kind === 'BOARD' && source.boardId
          ? source.boardId
          : null;
        return {
          ...current,
          meterPresent: true,
          meteringState: { kind: 'METERED', measurementAssignmentIds: existingAssignment ? [existingAssignment.id] : [] },
          meterSwitchboardId: directSupplyBoardId,
          meterId: directSupplyBoardId && currentMeter?.installedOnBoardId === directSupplyBoardId
            ? current.meterId
            : null,
          meterChannelIds: directSupplyBoardId && currentMeter?.installedOnBoardId === directSupplyBoardId
            ? current.meterChannelIds
            : [],
          meterChannels: directSupplyBoardId && currentMeter?.installedOnBoardId === directSupplyBoardId
            ? current.meterChannels
            : [],
          phaseMode: current.phaseMode || 'SINGLE_PHASE',
          measurementDirection: current.measurementDirection || 'CONSUMPTION',
          meterSwitchboardTbc: false,
        };
      }
      return kind === 'UNMETERED' ? {
        ...current,
        meterPresent: false,
        meteringState: { kind: 'UNMETERED' },
        meterSwitchboardId: null,
        meterSwitchboardTbc: false,
        meterId: null,
        meterChannelIds: [],
        meterChannels: [],
        phaseMode: null,
        measurementDirection: null,
      } : {
        ...current,
        meterPresent: false,
        meteringState: { kind: 'TBC' },
        meterSwitchboardId: null,
        meterSwitchboardTbc: true,
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

  function openQuickBoard() {
    setQuickBoardName(defaultBoardName('DB'));
    setQuickBoardType('DB');
    setQuickBoardCustomType('');
    setQuickBoardOpen(true);
  }

  async function addQuickBoard() {
    const normalizedQuickBoardName = quickBoardName.trim()
      || defaultBoardName(quickBoardType, quickBoardCustomType);
    setQuickBoardBusy(true);
    try {
      let createdBoardId = '';
      await writer.mutate((next) => {
        const board = createBoard(installationId, zoneId);
        board.assetName = normalizedQuickBoardName;
        board.typeCode = quickBoardType;
        board.assetType = legacyBoardType(quickBoardType);
        board.customTypeName = quickBoardType === 'OTHER'
          ? quickBoardCustomType.trim() || null
          : null;
        const assetSource = assetElectricalSource(currentDraft);
        const directBoard = assetSource.kind === 'BOARD'
          ? next.electricalAssets.find((item) => item.id === assetSource.boardId)
          : undefined;
        if (assetSource.kind === 'BOARD' && directBoard) {
          applyBoardElectricalSource(board, { kind: 'BOARD', boardId: assetSource.boardId });
        } else if (assetSource.kind === 'GRID' && (next.gridSupplies || []).some((item) => item.id === assetSource.gridSupplyId)) {
          applyBoardElectricalSource(board, assetSource);
        } else {
          applyBoardElectricalSource(board, { kind: 'GRID', gridSupplyId: primaryGridSupply(next).id });
        }
        const displayName = boardDisplayMetadata(next, board);
        board.displayCode = displayName.value;
        board.displayCodeMeta = displayName;
        board.updatedAt = nowIso();
        next.electricalAssets.push(board);
        createdBoardId = board.id;
      }, 'metadata');
      setDraft((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        applyAssetElectricalSource(next, { kind: 'BOARD', boardId: createdBoardId });
        next.meterSwitchboardId = siteAssetMeteringState(next).kind === 'METERED'
          ? createdBoardId
          : null;
        next.meterSwitchboardTbc = false;
        next.meterId = null;
        next.meterChannelIds = [];
        next.meterChannels = [];
        return next;
      });
      setQuickBoardOpen(false);
      toast.success(`${normalizedQuickBoardName} added and selected.`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setQuickBoardBusy(false);
    }
  }

  function chooseMeter(meterId: string) {
    setDraft((current) => current ? {
      ...current,
      meterSwitchboardId: directSupplyBoardId,
      meterSwitchboardTbc: !directSupplyBoardId,
      meterId: meterId || null,
      meterChannelIds: [],
      meterChannels: [],
    } : current);
    setApprovedTakeoverAssignmentIds(new Set());
  }

  async function addDeviceToMeterBoard() {
    const meterBoardId = directSupplyBoardId;
    const meterBoard = tree.electricalAssets.find((item) => item.id === meterBoardId);
    if (!meterBoardId || !meterBoard) {
      toast.error('Choose the supplying switchboard before adding its meter.');
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
    setDetourBusy(true);
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

  function assignmentDeviceDetails(assignment: MeasurementAssignment) {
    const device = meterDevices(tree).find((item) => item.id === assignment.meterId);
    const meterBoard = device
      ? tree.electricalAssets.find((item) => item.id === device.installedOnBoardId)
      : undefined;
    const channelOrdinals = device
      ? assignment.channelIds
        .map((channelId) => device.channels.find((channel) => channel.id === channelId)?.ordinal)
        .filter((ordinal): ordinal is number => typeof ordinal === 'number')
      : [];
    return {
      device,
      meterBoard,
      channelOrdinals,
      href: device && meterBoard
        ? `/installhub/installations/${encodeURIComponent(installationId)}/zones/${encodeURIComponent(meterBoard.zoneId)}/boards/${encodeURIComponent(meterBoard.id)}/meters/${encodeURIComponent(device.id)}#meter-assignments`
        : null,
    };
  }

  function approveChannelTakeover() {
    if (!pendingChannelTakeover) return;
    setApprovedTakeoverAssignmentIds((current) => new Set(current).add(pendingChannelTakeover.assignment.id));
    toggleChannel(pendingChannelTakeover.channelId, true);
    setPendingChannelTakeover(null);
  }

  const pendingTakeoverTarget = pendingChannelTakeover
    ? measurementTargetDetails(tree, pendingChannelTakeover.assignment.target)
    : null;
  const pendingTakeoverDevice = pendingChannelTakeover
    ? assignmentDeviceDetails(pendingChannelTakeover.assignment)
    : null;

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
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
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
          title="Site asset navigation"
          description="Keep physical location, electrical supply, and measurement links distinct while moving directly to each related record."
          items={[
            {
              href: `/installhub/installations/${installationId}/zones/${zoneId}`,
              icon: 'map-pin',
              label: 'Physical zone',
              description: zone.zoneName,
            },
            ...(selectedSupplyBoard ? [{
              href: `/installhub/installations/${installationId}/zones/${selectedSupplyBoard.zoneId}/boards/${selectedSupplyBoard.id}`,
              icon: 'zap' as const,
              label: 'Supplying switchboard',
              description: `${selectedSupplyBoard.assetName} · ${boardTypeLabel(selectedSupplyBoard)}`,
            }] : [{
              href: '#asset-supply',
              icon: 'grid' as const,
              label: draftSource.kind === 'GRID' ? 'Grid supply' : 'Supply to confirm',
              description: draftSource.kind === 'GRID' ? primaryGridSupply(tree).name : 'Open the supply section',
            }]),
            ...(linkedMeter && linkedMeterBoard ? [{
              href: `/installhub/installations/${installationId}/zones/${linkedMeterBoard.zoneId}/boards/${linkedMeterBoard.id}/meters/${linkedMeter.id}`,
              icon: 'gauge' as const,
              label: 'Metering device',
              description: humanDeviceName(linkedMeter),
            }] : [{
              href: '#asset-metering',
              icon: 'gauge' as const,
              label: 'Metering relationship',
              description: siteAssetMeteringState(draft).kind.replaceAll('_', ' '),
            }]),
            ...selectedChannels.map((channel) => ({
              href: `/installhub/installations/${installationId}/zones/${linkedMeterBoard!.zoneId}/boards/${linkedMeterBoard!.id}/meters/${linkedMeter!.id}#meter-channel-${linkedMeter!.channels.findIndex((candidate) => candidate.id === channel.id) + 1}`,
              icon: 'plug' as const,
              label: `Channel ${channel.ordinal}`,
              description: channel.description || channel.loadTypeCode || channel.purpose.replaceAll('_', ' ').toLowerCase(),
            })),
            {
              href: '#asset-evidence',
              icon: 'camera',
              label: 'Site asset evidence',
              description: 'Location and supporting photos',
              meta: (latest.locationPhoto ? 1 : 0) + latest.extraPhotos.length,
            },
          ]}
        />
      ) : null}

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

      <form onSubmit={(event) => void save(event)}>
        <Card id="asset-identity" className="mb-5">
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="asset-name">Asset name</FieldLabel>
              <Input
                id="asset-name"
                maxLength={ENTITY_NAME_MAX_LENGTH}
                value={draft.assetName}
                onChange={(event) => setAssetName(event.target.value)}
              />
              <FieldHint>Optional. If left blank, the asset type is used as the name.</FieldHint>
            </div>
            <div>
              <FieldLabel htmlFor="asset-type">Asset type</FieldLabel>
              <Select id="asset-type" value={siteAssetTypeCode(draft)} onChange={(event) => chooseAssetType(event.target.value)}>
                {SITE_ASSET_TYPE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
              </Select>
            </div>
            {siteAssetTypeCode(draft) === 'OTHER' ? (
              <div>
                <FieldLabel htmlFor="asset-custom-type">Custom asset type</FieldLabel>
                <Input
                  id="asset-custom-type"
                  value={draft.customTypeName ?? ''}
                  onChange={(event) => setAssetCustomType(event.target.value)}
                />
                <FieldHint>Optional. Leave blank to retain the generic “Other” type.</FieldHint>
              </div>
            ) : null}
            <div>
              <FieldLabel htmlFor="asset-display-code">Generated asset ID</FieldLabel>
              <Input
                id="asset-display-code"
                readOnly
                value={draft.displayCodeMeta?.value || draft.displayCode || ''}
              />
              <FieldHint>
                {draft.displayCodeMeta?.provisional !== true
                  ? 'This confirmed identifier is fixed.'
                  : 'Built from installation code, zone code, shared sequence, and asset name. The server confirms it on save.'}
              </FieldHint>
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
                { value: 'GRID', label: 'Incoming grid connection', description: primaryGridSupply(tree).name },
                { value: 'BOARD', label: 'Switchboard', description: 'Choose from every switchboard already captured.' },
                { value: 'TBC', label: 'To be confirmed', description: 'Reconcile this relationship before completion.' },
              ]}
              onChange={chooseSource}
            />
            {draftSource.kind === 'GRID' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <FieldLabel htmlFor="asset-grid-supply" className="mt-0">Grid supply</FieldLabel>
                <Select
                  id="asset-grid-supply"
                  value={draftSource.gridSupplyId}
                  onChange={(event) => {
                    const gridSupplyId = event.target.value;
                    setDraft((current) => {
                      if (!current) return current;
                      const next = structuredClone(current);
                      applyAssetElectricalSource(next, { kind: 'GRID', gridSupplyId });
                      return next;
                    });
                  }}
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
                <FieldLabel htmlFor="asset-source-board" className="mt-0">Supplying switchboard</FieldLabel>
                <Select
                  id="asset-source-board"
                  value={draftSource.boardId}
                  onChange={(event) => {
                    const selectedBoardId = event.target.value;
                    setDraft((current) => {
                      if (!current) return current;
                      const next = structuredClone(current);
                      applyAssetElectricalSource(next, { kind: 'BOARD', boardId: selectedBoardId });
                      next.meterSwitchboardId = siteAssetMeteringState(next).kind === 'METERED'
                        ? selectedBoardId || null
                        : null;
                      next.meterSwitchboardTbc = false;
                      next.meterId = null;
                      next.meterChannelIds = [];
                      return next;
                    });
                  }}
                >
                  <option value="">Leave to be confirmed</option>
                  {sourceBoards.map((board) => {
                    const boardZone = tree.zones.find((item) => item.id === board.zoneId);
                    return <option key={board.id} value={board.id}>{board.assetName} · {boardTypeLabel(board)} · {boardZone?.zoneName || 'Unknown zone'}</option>;
                  })}
                </Select>
                <div className="mt-3">
                  <Button variant="secondary" onClick={openQuickBoard} disabled={busy || quickBoardBusy}>
                    <Icon name="plus" size={16} />Add new switchboard
                  </Button>
                </div>
              </div>
            ) : null}
            {draftSource.kind === 'TBC' ? <InlineNotice>Supply is left as TBC and will stay outside the resolved electrical map.</InlineNotice> : null}
          </div>

          <div id="asset-metering" tabIndex={-1} className="mt-6 border-t border-[var(--border)] pt-2">
            <ChoiceGroup<MeteringStateKind>
              label="How is this asset measured?"
              hint="Do not infer metering from missing fields; record the observed state explicitly."
              value={meteringState.kind}
              options={[
                { value: 'METERED', label: 'Metered', description: 'Map an exact device and channel group.' },
                { value: 'UNMETERED', label: 'Unmetered', description: 'Confirmed: no direct metering is installed.' },
                { value: 'TBC', label: 'To be confirmed', description: 'Leave the metering relationship unresolved for later.' },
              ]}
              onChange={chooseMetering}
            />
            {meteringState.kind === 'TBC' ? (
              <InlineNotice>Metering is left as TBC. You can save now and resolve it later.</InlineNotice>
            ) : null}

            {meteringState.kind === 'METERED' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <div className="rounded-xl border border-[var(--green)]/30 bg-[var(--green-soft)] p-3">
                  <p className="text-sm font-extrabold text-[var(--text)]">Meters on the supplying switchboard</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
                    {selectedSupplyBoard
                      ? `${selectedSupplyBoard.assetName} · ${boardTypeLabel(selectedSupplyBoard)}`
                      : 'Choose a supplying switchboard above to see its installed meters.'}
                  </p>
                </div>

                {unavailableLinkedMeter ? (
                  <div className="mt-3">
                    <InlineNotice tone="warning">
                      <strong>Existing meter link retained as read-only.</strong>{' '}
                      {linkedMeter
                        ? `${humanDeviceName(linkedMeter)} is ${linkedMeter.lifecycleState === 'INACTIVE' ? 'inactive' : `installed on ${linkedMeterBoard?.assetName || 'another switchboard'}`}.`
                        : `Meter ${draft.meterId} is no longer available in the active meter register.`}{' '}
                      Saving unrelated changes will not alter this historical link. Choose an active meter on the supplying switchboard to replace it.
                      {linkedMeter && linkedMeterBoard ? (
                        <>{' '}<Link className="font-semibold underline" href={`/installhub/installations/${installationId}/zones/${linkedMeterBoard.zoneId}/boards/${linkedMeterBoard.id}/meters/${linkedMeter.id}`}>Open existing meter</Link></>
                      ) : null}
                    </InlineNotice>
                  </div>
                ) : null}

                <FieldLabel htmlFor="asset-meter">Exact metering device</FieldLabel>
                <SearchableSelect
                  id="asset-meter"
                  value={formSelectedMeter?.id ?? ''}
                  options={meterOptions}
                  disabled={!directSupplyBoardId}
                  describedBy="asset-meter-hint"
                  placeholder="Search name, model, serial, or stable ID"
                  emptyMessage="No active metering devices match this search."
                  onChange={chooseMeter}
                />
                <FieldHint id="asset-meter-hint">Only active meters installed on the selected supplying switchboard are shown. Up to 100 of {eligibleMeters.length} matching devices are available.</FieldHint>
                {directSupplyBoardId && eligibleMeters.length === 0 ? (
                  <FieldHint>No active metering devices are installed on the supplying switchboard.</FieldHint>
                ) : null}
                {directSupplyBoardId ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button variant="secondary" disabled={Boolean(detourHref) || detourBusy || busy} onClick={() => void addDeviceToMeterBoard()}>
                      <Icon name="plus" size={16} />{detourHref || detourBusy ? 'Opening meter options…' : 'Add a new meter'}
                    </Button>
                    <p className="text-xs leading-5 text-[var(--text-sub)]">Opens the full WW installation form. After commissioning, this asset draft returns so you can select the new device’s exact channels.</p>
                  </div>
                ) : null}

                <ChoiceGroup<PhaseMode>
                  label="How many phases does this asset use?"
                  hint="This describes the observed channel grouping. An incomplete selection is saved as TBC."
                  value={draft.phaseMode || 'SINGLE_PHASE'}
                  options={[
                    { value: 'SINGLE_PHASE', label: 'Single phase', description: 'Uses one observed channel when confirmed.' },
                    { value: 'THREE_PHASE', label: 'Three phase', description: 'Uses three observed channels when confirmed.' },
                    { value: 'OTHER', label: 'Other grouping', description: 'Select the observed channel group.' },
                  ]}
                  onChange={(value) => {
                    set('phaseMode', value);
                    set('meterChannelIds', []);
                  }}
                />

                <ChoiceGroup<MeasurementDirection>
                  label="What energy flow does the device measure for this asset?"
                  value={draft.measurementDirection || 'CONSUMPTION'}
                  options={[
                    { value: 'CONSUMPTION', label: 'Consumption', description: 'Load consumes energy.' },
                    { value: 'GENERATION', label: 'Generation', description: 'Source exports generated energy.' },
                    { value: 'BIDIRECTIONAL', label: 'Bidirectional', description: 'Flow may occur in both directions.' },
                  ]}
                  onChange={(value) => set('measurementDirection', value)}
                />

                <fieldset id="asset-channels" className="mt-5" tabIndex={-1} aria-describedby="asset-channel-group-status">
                  <legend className="text-sm font-bold text-[var(--text)]">Measured channels</legend>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Select the observed physical channel or channels wired to this asset. Incomplete mappings are saved as TBC. Occupied channels show their exact attachment and can be reassigned when the existing target is another site asset.</p>
                  <p id="asset-channel-group-status" className="mt-1 text-xs font-semibold text-[var(--text-sub)]" role="status" aria-live="polite" aria-atomic="true">{channelGroupAnnouncement}</p>
                  {!formSelectedMeter ? <p className="mt-3 text-sm text-[var(--text-sub)]">Choose an active meter on the supplying switchboard to see its channels.</p> : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {formSelectedMeter.channels.map((channel) => {
                        const ownerAssignment = usedChannelAssignments.get(channel.id);
                        const ownerTarget = ownerAssignment
                          ? measurementTargetDetails(tree, ownerAssignment.target)
                          : null;
                        const ownerDevice = ownerAssignment
                          ? assignmentDeviceDetails(ownerAssignment)
                          : null;
                        const takeoverApproved = Boolean(ownerAssignment && approvedTakeoverAssignmentIds.has(ownerAssignment.id));
                        const claimableTbc = ownerAssignment?.target.kind === 'TBC';
                        const protectedTarget = ownerAssignment
                          && ownerAssignment.target.kind !== 'SITE_ASSET'
                          && ownerAssignment.target.kind !== 'TBC';
                        const unavailable = channel.purpose === 'SPARE'
                          || Boolean(ownerAssignment && !claimableTbc && !takeoverApproved);
                        const unavailableReasonId = channel.purpose === 'SPARE' || ownerAssignment
                          ? `asset-channel-${channel.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}-reason`
                          : undefined;
                        return (
                          <div key={channel.id} className={`rounded-xl border px-3 py-2 ${unavailable ? 'border-[var(--amber)] bg-[var(--surface)]' : 'border-[var(--border-strong)] bg-[var(--surface)]'}`}>
                            <Checkbox
                              label={`Channel ${channel.ordinal} — ${channel.description || channel.loadTypeCode || channel.purpose.replaceAll('_', ' ').toLowerCase()}`}
                              checked={(draft.meterChannelIds || []).includes(channel.id)}
                              disabled={unavailable}
                              ariaDescribedBy={unavailableReasonId}
                              onChange={(checked) => toggleChannel(channel.id, checked)}
                            />
                            {channel.purpose === 'SPARE' ? (
                              <p id={unavailableReasonId} className="pl-8 text-xs font-semibold text-[var(--amber)]">Unavailable: marked spare on the device.</p>
                            ) : ownerAssignment && ownerTarget && ownerDevice ? (
                              <div id={unavailableReasonId} className="space-y-1 pb-1 pl-8 text-xs leading-5">
                                <p className="font-semibold text-[var(--amber)]">
                                  {claimableTbc
                                    ? 'Available to claim from a TBC measurement group.'
                                    : takeoverApproved
                                      ? `Reassignment approved from ${ownerTarget.label}.`
                                      : `Occupied by ${ownerTarget.label}.`}
                                </p>
                                <p className="text-[var(--text-sub)]">
                                  Attached through {ownerDevice.device ? humanDeviceName(ownerDevice.device) : `device ${ownerAssignment.meterId}`}
                                  {ownerDevice.meterBoard ? ` on ${ownerDevice.meterBoard.assetName}` : ''}; existing group channel{ownerDevice.channelOrdinals.length === 1 ? '' : 's'} {ownerDevice.channelOrdinals.join(', ') || ownerAssignment.channelIds.join(', ')}.
                                </p>
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                  {ownerTarget.href ? <Link className="font-semibold text-[var(--blue)] underline" href={ownerTarget.href}>Open attached target</Link> : null}
                                  {ownerDevice.href ? <Link className="font-semibold text-[var(--blue)] underline" href={ownerDevice.href}>Open device mapping</Link> : null}
                                </div>
                                {ownerAssignment.target.kind === 'SITE_ASSET' && !takeoverApproved ? (
                                  <Button
                                    variant="secondary"
                                    className="mt-1"
                                    onClick={() => setPendingChannelTakeover({ assignment: ownerAssignment, channelId: channel.id })}
                                  >
                                    Reassign to this asset
                                  </Button>
                                ) : null}
                                {claimableTbc ? <p className="text-[var(--text-sub)]">Selecting this channel replaces the existing TBC group; no confirmed asset will be displaced.</p> : null}
                                {protectedTarget ? <p className="font-semibold text-[var(--text-sub)]">Switchboard and Grid totals are protected. Change this from the device mapping.</p> : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              </div>
            ) : null}
            {meteringState.kind === 'UNMETERED' ? <InlineNotice>This asset is intentionally retained in the full asset register without a direct channel assignment.</InlineNotice> : null}
          </div>

          <FieldLabel htmlFor="asset-comments">Comments</FieldLabel>
          <Textarea id="asset-comments" value={draft.comments ?? ''} onChange={(event) => set('comments', event.target.value)} />
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save site asset'}</Button>
            <Button
              variant="secondary"
              onClick={() => requestTreeNavigation(
                () => router.replace(`/installhub/installations/${installationId}/zones/${zoneId}`),
                'the site asset list',
              )}
              disabled={busy}
            >Cancel</Button>
          </div>
        </Card>
      </form>

      <ConfirmDialog
        open={Boolean(pendingChannelTakeover)}
        title={`Reassign this channel to ${draft.assetName || 'this site asset'}?`}
        description={pendingTakeoverTarget
          ? `This is a deliberate transfer from ${pendingTakeoverTarget.label}. The transfer is applied atomically when you save this site asset.`
          : 'This is a deliberate channel transfer. The transfer is applied atomically when you save this site asset.'}
        consequences={[
          pendingTakeoverTarget ? `${pendingTakeoverTarget.label} will be delinked and changed to To be confirmed` : 'The previous site asset will be delinked and changed to To be confirmed',
          pendingTakeoverDevice?.channelOrdinals.length
            ? `Its full existing measurement group (channel${pendingTakeoverDevice.channelOrdinals.length === 1 ? '' : 's'} ${pendingTakeoverDevice.channelOrdinals.join(', ')}) will be released`
            : 'Its full existing measurement group will be released',
          'This channel will be selected here; add any other observed phase channels, or save the incomplete mapping as TBC',
        ]}
        confirmLabel="Approve reassignment"
        blockedMessage={tree.installation.status === 'Completed' ? 'Reopen this completed installation before reassigning channels.' : undefined}
        onConfirm={approveChannelTakeover}
        onCancel={() => setPendingChannelTakeover(null)}
      />

      <ConfirmDialog
        open={quickBoardOpen}
        title="Add a switchboard"
        description="The new switchboard will be added in this asset’s physical zone, inherit the asset’s current upstream supply, and become this asset’s supplying switchboard."
        confirmLabel="Add and select switchboard"
        danger={false}
        busy={quickBoardBusy}
        onConfirm={() => void addQuickBoard()}
        onCancel={() => setQuickBoardOpen(false)}
      >
        <div className="grid gap-x-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="quick-board-name" className="mt-0">Switchboard name</FieldLabel>
            <Input
              id="quick-board-name"
              value={quickBoardName}
              autoFocus
              maxLength={ENTITY_NAME_MAX_LENGTH}
              onChange={(event) => setQuickBoardName(event.target.value)}
            />
            <FieldHint>Optional. If left blank, the switchboard type is used as the name.</FieldHint>
          </div>
          <div>
            <FieldLabel htmlFor="quick-board-type" className="mt-0">Switchboard type</FieldLabel>
            <Select id="quick-board-type" value={quickBoardType} onChange={(event) => {
              const nextType = event.target.value;
              setQuickBoardName((current) => nameAfterTypeChange(
                current,
                defaultBoardName(quickBoardType, quickBoardCustomType),
                defaultBoardName(nextType, nextType === 'OTHER' ? quickBoardCustomType : null),
              ));
              setQuickBoardType(nextType);
            }}>
              {BOARD_TYPE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </Select>
          </div>
          {quickBoardType === 'OTHER' ? (
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="quick-board-custom-type">Custom switchboard type</FieldLabel>
              <Input
                id="quick-board-custom-type"
                value={quickBoardCustomType}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuickBoardName((current) => nameAfterTypeChange(
                    current,
                    defaultBoardName('OTHER', quickBoardCustomType),
                    defaultBoardName('OTHER', value),
                  ));
                  setQuickBoardCustomType(value);
                }}
              />
              <FieldHint>Optional. Leave blank to retain the generic “Other” type.</FieldHint>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="quick-board-display-code">Generated asset ID</FieldLabel>
            <Input
              id="quick-board-display-code"
              readOnly
              value={generatedDisplayCodeV3(tree, {
                zoneId,
                customName: quickBoardName,
                fallbackType: defaultBoardName(quickBoardType, quickBoardCustomType),
                entityKind: 'board',
                entityTypeCode: quickBoardType,
              })}
            />
            <FieldHint>The same installation/zone sequence is used as the full switchboard form.</FieldHint>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingMeteringKind)}
        title={pendingMeteringKind === 'TBC'
          ? 'Leave metering as To be confirmed?'
          : 'Change metering to Unmetered?'}
        description={pendingMeteringKind === 'TBC'
          ? 'The exact active meter and channel relationship will be removed, and this asset will be listed as unresolved.'
          : 'The exact active meter and channel relationship will be removed from this asset.'}
        consequences={[
          `${draft.meterChannelIds?.length || existingAssignment?.channelIds.length || 0} assigned channel${(draft.meterChannelIds?.length || existingAssignment?.channelIds.length || 0) === 1 ? '' : 's'} will be released`,
          draft.meterId ? `Meter ${draft.meterId} will remain in the active device register` : 'The metering device remains unchanged',
          pendingMeteringKind === 'TBC'
            ? 'The asset will remain in the register with metering marked TBC'
            : 'The asset will remain in the register as confirmed unmetered',
        ]}
        confirmLabel={pendingMeteringKind === 'TBC' ? 'Leave as TBC' : 'Change metering'}
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
        <InlineNotice>Save the site asset first, then add evidence.</InlineNotice>
      ) : (
        <Card id="asset-evidence" tabIndex={-1} className="scroll-mt-4">
            <h2 className="font-extrabold text-[var(--text)]">Site asset evidence</h2>
            <EvidenceField
              id="asset-location-photo"
              label="Location photo"
              items={latest.locationPhoto ? [{ id: 'location', uri: latest.locationPhoto }] : []}
              busy={uploading}
              onFiles={uploadLocation}
              onRemove={latest.locationPhoto ? () => removePhoto('location') : undefined}
            />
            <EvidenceField
              id="asset-extra-photos"
              label="Extra photos"
              items={latest.extraPhotos.map((uri, index) => ({ id: `${index}`, uri }))}
              busy={uploading}
              onFiles={uploadExtra}
              onRemove={latest.extraPhotos.length ? (id) => removePhoto('extra', id) : undefined}
            />
        </Card>
      )}
    </div>
  );
}
