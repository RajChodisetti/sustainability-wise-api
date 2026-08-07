'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed asset editor from its server query record */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
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
import { createBoard, createSiteAsset, nowIso } from '@/modules/installhub/lib/model';
import {
  ASSET_METER_FILTER_HINT,
  ASSET_METER_FILTER_LABEL,
  assetMeterDraftKey,
  measurementTargetDetails,
  parseAssetMeterDraftSnapshot,
  pinSelectedResult,
  shouldShowMeterLocationOverride,
  shouldClearAssetMeterDraft,
  ASSET_METER_DRAFT_KEY_PREFIX,
  type AssetMeterDraftSnapshot,
} from '@/modules/installhub/lib/electricalPresentation';
import type {
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
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  assetElectricalSource,
  boardTypeLabel,
  legacyBoardType,
  legacySiteAssetType,
  measurementAssignments,
  meterBoardsForAsset,
  insertBoardUpstreamOfAssetSupply,
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
  const [meterSearch, setMeterSearch] = useState('');
  const [meterLocationOverrideOpen, setMeterLocationOverrideOpen] = useState(false);
  const [errors, setErrors] = useState<Array<{ id?: string; message: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingMeteringKind, setPendingMeteringKind] = useState<'UNMETERED' | null>(null);
  const [pendingChannelTakeover, setPendingChannelTakeover] = useState<{
    assignment: MeasurementAssignment;
    channelId: string;
  } | null>(null);
  const [approvedTakeoverAssignmentIds, setApprovedTakeoverAssignmentIds] = useState<Set<string>>(new Set());
  const [quickBoardOpen, setQuickBoardOpen] = useState(false);
  const [quickBoardPurpose, setQuickBoardPurpose] = useState<'SUPPLY' | 'METER_LOCATION'>('SUPPLY');
  const [quickBoardName, setQuickBoardName] = useState(defaultBoardName('DB'));
  const [quickBoardType, setQuickBoardType] = useState('DB');
  const [quickBoardCustomType, setQuickBoardCustomType] = useState('');
  const [quickBoardError, setQuickBoardError] = useState('');
  const [quickBoardCustomTypeError, setQuickBoardCustomTypeError] = useState('');
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
  const eligibleMeterBoards = meterBoardsForAsset(tree, draft)
    .sort((left, right) => left.id.localeCompare(right.id));
  const filteredMeterBoards = pinSelectedResult(
    eligibleMeterBoards,
    eligibleMeterBoards,
    draft.meterSwitchboardId,
    (item) => item.id,
  );
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
  const selectedSupplyBoard = draftSource.kind === 'BOARD'
    ? tree.electricalAssets.find((board) => board.id === draftSource.boardId)
    : undefined;
  const selectedMeterBoard = tree.electricalAssets.find((board) => board.id === draft.meterSwitchboardId);
  const directSupplyBoardId = selectedSupplyBoard?.id ?? null;
  const showMeterLocationOverride = shouldShowMeterLocationOverride({
    overrideRequested: meterLocationOverrideOpen,
    directSupplyBoardId,
    meterSwitchboardId: draft.meterSwitchboardId,
    meterSwitchboardTbc: draft.meterSwitchboardTbc,
  });
  const selectedChannels = selectedMeter && selectedMeterBoard
    ? selectedMeter.channels
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
  const channelGroupAnnouncement = `${selectedPhaseMode.replaceAll('_', ' ').toLowerCase()} requires ${requiredChannelCount ?? 'one or more'} channel${requiredChannelCount === 1 ? '' : 's'}. ${selectedChannelCount} selected. ${channelGroupComplete ? 'Channel group complete.' : 'Channel group incomplete.'}`;
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
    const nextErrors: Array<{ id?: string; message: string }> = [];
    if (!currentDraft.assetName.trim()) nextErrors.push({ id: 'asset-name', message: 'Enter the site asset name.' });
    else if (currentDraft.assetName.trim().length > ENTITY_NAME_MAX_LENGTH) nextErrors.push({ id: 'asset-name', message: `Use ${ENTITY_NAME_MAX_LENGTH} characters or fewer for the site asset name.` });
    if (siteAssetTypeCode(currentDraft) === 'OTHER' && !currentDraft.customTypeName?.trim()) {
      nextErrors.push({ id: 'asset-custom-type', message: 'Enter the custom site asset type.' });
    }
    const electricalSource = assetElectricalSource(currentDraft);
    if (electricalSource.kind === 'BOARD' && !electricalSource.boardId) {
      nextErrors.push({ id: 'asset-source-board', message: 'Choose the confirmed supplying switchboard.' });
    }
    const state = siteAssetMeteringState(currentDraft);
    if (state.kind === 'TBC') {
      nextErrors.push({ id: 'asset-metering', message: 'Choose Metered or Unmetered before saving this asset.' });
    }
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
      const selectedConflicts = [...new Set((currentDraft.meterChannelIds || [])
        .map((id) => usedChannelAssignments.get(id))
        .filter((assignment): assignment is MeasurementAssignment => Boolean(assignment)))];
      const blockedConflict = selectedConflicts.find((assignment) => (
        assignment.target.kind !== 'TBC'
        && !(assignment.target.kind === 'SITE_ASSET' && approvedTakeoverAssignmentIds.has(assignment.id))
      ));
      if (blockedConflict) {
        const details = measurementTargetDetails(tree, blockedConflict.target);
        nextErrors.push({ id: 'asset-channels', message: `A selected channel is still assigned to ${details.label}. Approve the reassignment first.` });
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
        const display = siteAssetDisplayMetadata(
          next,
          currentDraft,
          currentDraft.assetName.trim(),
        );
        const value: SiteAsset = {
          ...structuredClone(currentDraft),
          assetName: currentDraft.assetName.trim(),
          assetType: legacySiteAssetType(siteAssetTypeCode(currentDraft)),
          typeCode: siteAssetTypeCode(currentDraft),
          customTypeName: siteAssetTypeCode(currentDraft) === 'OTHER' ? currentDraft.customTypeName?.trim() : null,
          displayCode: display.value,
          displayCodeMeta: display,
          updatedAt: nowIso(),
        };
        applyAssetElectricalSource(value, electricalSource);
        if (state.kind === 'METERED') {
          const takeoverAssignmentIds = [...new Set((currentDraft.meterChannelIds || [])
            .map((channelId) => usedChannelAssignments.get(channelId))
            .filter((assignment): assignment is MeasurementAssignment => (
              assignment?.target.kind === 'SITE_ASSET'
              && approvedTakeoverAssignmentIds.has(assignment.id)
            ))
            .map((assignment) => assignment.id))];
          setAssetMetering(next, value, {
            kind: 'METERED',
            meterId: currentDraft.meterId!,
            channelIds: currentDraft.meterChannelIds || [],
            phaseMode: currentDraft.phaseMode || 'OTHER',
            direction: currentDraft.measurementDirection || 'CONSUMPTION',
          }, takeoverAssignmentIds.length ? {
            takeoverApproval: { assignmentIds: takeoverAssignmentIds },
          } : undefined);
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
    setMeterLocationOverrideOpen(false);
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

  function applyMeteringChoice(kind: 'METERED' | 'UNMETERED') {
    if (kind === 'UNMETERED' || selectedSupplyBoard) {
      setMeterLocationOverrideOpen(false);
    }
    setDraft((current) => {
      if (!current) return current;
      if (kind === 'METERED') {
        const source = assetElectricalSource(current);
        const directSupplyBoardId = source.kind === 'BOARD' && source.boardId
          ? source.boardId
          : null;
        return {
          ...current,
          meterPresent: true,
          meteringState: { kind: 'METERED', measurementAssignmentIds: existingAssignment ? [existingAssignment.id] : [] },
          meterSwitchboardId: current.meterSwitchboardId || directSupplyBoardId,
          phaseMode: current.phaseMode || 'SINGLE_PHASE',
          measurementDirection: current.measurementDirection || 'CONSUMPTION',
          meterSwitchboardTbc: false,
        };
      }
      return {
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
      };
    });
  }

  function chooseMetering(kind: 'METERED' | 'UNMETERED') {
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

  function openQuickBoard(purpose: 'SUPPLY' | 'METER_LOCATION') {
    setQuickBoardPurpose(purpose);
    setQuickBoardName(defaultBoardName('DB'));
    setQuickBoardType('DB');
    setQuickBoardCustomType('');
    setQuickBoardError('');
    setQuickBoardCustomTypeError('');
    setQuickBoardOpen(true);
  }

  async function addQuickBoard() {
    if (!quickBoardName.trim()) {
      setQuickBoardError('Enter the switchboard name.');
      document.getElementById('quick-board-name')?.focus();
      return;
    }
    if (quickBoardName.trim().length > ENTITY_NAME_MAX_LENGTH) {
      setQuickBoardError(`Use ${ENTITY_NAME_MAX_LENGTH} characters or fewer for the switchboard name.`);
      document.getElementById('quick-board-name')?.focus();
      return;
    }
    if (quickBoardType === 'OTHER' && !quickBoardCustomType.trim()) {
      setQuickBoardCustomTypeError('Enter the custom switchboard type.');
      document.getElementById('quick-board-custom-type')?.focus();
      return;
    }
    setQuickBoardBusy(true);
    try {
      let createdBoardId = '';
      await writer.mutate((next) => {
        const board = createBoard(installationId, zoneId);
        board.assetName = quickBoardName.trim();
        board.typeCode = quickBoardType;
        board.assetType = legacyBoardType(quickBoardType);
        board.customTypeName = quickBoardType === 'OTHER'
          ? quickBoardCustomType.trim()
          : null;
        const assetSource = assetElectricalSource(currentDraft);
        const directBoard = assetSource.kind === 'BOARD'
          ? next.electricalAssets.find((item) => item.id === assetSource.boardId)
          : undefined;
        if (quickBoardPurpose === 'METER_LOCATION' && assetSource.kind === 'BOARD') {
          const insertedBelow = insertBoardUpstreamOfAssetSupply(next, currentDraft, board);
          if (!insertedBelow) throw new Error('The supplying switchboard is no longer available. Refresh and try again.');
          insertedBelow.updatedAt = nowIso();
        } else if (assetSource.kind === 'BOARD' && directBoard) {
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
        const sourceBeforeAdd = assetElectricalSource(current);
        if (quickBoardPurpose === 'SUPPLY' || sourceBeforeAdd.kind !== 'BOARD') {
          applyAssetElectricalSource(next, { kind: 'BOARD', boardId: createdBoardId });
        }
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
      setMeterLocationOverrideOpen(false);
      toast.success(`${quickBoardName.trim()} added and selected.`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setQuickBoardBusy(false);
    }
  }

  function chooseMeterBoard(boardId: string) {
    if (boardId && boardId === directSupplyBoardId) {
      setMeterLocationOverrideOpen(false);
    }
    setDraft((current) => current ? {
      ...current,
      meterSwitchboardId: boardId || null,
      meterSwitchboardTbc: false,
      meterId: null,
      meterChannelIds: [],
      meterChannels: [],
    } : current);
    setApprovedTakeoverAssignmentIds(new Set());
  }

  function chooseMeter(meterId: string) {
    setDraft((current) => current ? {
      ...current,
      meterId: meterId || null,
      meterChannelIds: [],
      meterChannels: [],
    } : current);
    setApprovedTakeoverAssignmentIds(new Set());
  }

  async function addDeviceToMeterBoard() {
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
            ...(selectedMeter && selectedMeterBoard ? [{
              href: `/installhub/installations/${installationId}/zones/${selectedMeterBoard.zoneId}/boards/${selectedMeterBoard.id}/meters/${selectedMeter.id}`,
              icon: 'gauge' as const,
              label: 'Metering device',
              description: humanDeviceName(selectedMeter),
            }] : [{
              href: '#asset-metering',
              icon: 'gauge' as const,
              label: 'Metering relationship',
              description: siteAssetMeteringState(draft).kind.replaceAll('_', ' '),
            }]),
            ...selectedChannels.map((channel) => ({
              href: `/installhub/installations/${installationId}/zones/${selectedMeterBoard!.zoneId}/boards/${selectedMeterBoard!.id}/meters/${selectedMeter!.id}#meter-channel-${channel.ordinal}`,
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
      <ErrorSummary errors={errors} />

      <form onSubmit={(event) => void save(event)}>
        <Card id="asset-identity" className="mb-5">
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="asset-name">Asset name *</FieldLabel>
              <Input
                id="asset-name"
                required
                maxLength={ENTITY_NAME_MAX_LENGTH}
                value={draft.assetName}
                aria-invalid={errors.some((item) => item.id === 'asset-name')}
                aria-describedby={errors.some((item) => item.id === 'asset-name') ? 'asset-name-error' : undefined}
                onChange={(event) => setAssetName(event.target.value)}
              />
              <FieldHint>Defaults from the asset type, remains editable, and accepts up to {ENTITY_NAME_MAX_LENGTH} characters.</FieldHint>
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
                  onChange={(event) => setAssetCustomType(event.target.value)}
                />
                <FieldError id="asset-custom-type-error" message={errors.find((item) => item.id === 'asset-custom-type')?.message} />
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
                <FieldLabel htmlFor="asset-grid-supply" className="mt-0">Grid supply *</FieldLabel>
                <Select
                  id="asset-grid-supply"
                  value={draftSource.gridSupplyId}
                  onChange={(event) => {
                    const gridSupplyId = event.target.value;
                    setMeterLocationOverrideOpen(false);
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
                <FieldLabel htmlFor="asset-source-board" className="mt-0">Supplying switchboard *</FieldLabel>
                <Select
                  id="asset-source-board"
                  value={draftSource.boardId}
                  aria-invalid={errors.some((item) => item.id === 'asset-source-board')}
                  onChange={(event) => {
                    const selectedBoardId = event.target.value;
                    setMeterLocationOverrideOpen(false);
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
                  <option value="">Choose a switchboard</option>
                  {sourceBoards.map((board) => {
                    const boardZone = tree.zones.find((item) => item.id === board.zoneId);
                    return <option key={board.id} value={board.id}>{board.assetName} · {boardTypeLabel(board)} · {boardZone?.zoneName || 'Unknown zone'}</option>;
                  })}
                </Select>
                <FieldError message={errors.find((item) => item.id === 'asset-source-board')?.message} />
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => openQuickBoard('SUPPLY')} disabled={busy || quickBoardBusy}>
                    <Icon name="plus" size={16} />Add new switchboard
                  </Button>
                </div>
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
              ]}
              onChange={(value) => chooseMetering(value as 'METERED' | 'UNMETERED')}
            />
            <FieldError message={errors.find((item) => item.id === 'asset-metering')?.message} />
            {meteringState.kind === 'TBC' ? (
              <InlineNotice>This older asset has no confirmed metering state. Choose Metered or Unmetered before saving.</InlineNotice>
            ) : null}

            {meteringState.kind === 'METERED' ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                {showMeterLocationOverride ? (
                  <div>
                    <FieldLabel htmlFor="asset-meter-board" className="mt-0">
                      {directSupplyBoardId ? 'Upstream meter location *' : 'Meter location *'}
                    </FieldLabel>
                    <Select
                      id="asset-meter-board"
                      value={draft.meterSwitchboardId ?? ''}
                      aria-invalid={errors.some((item) => item.id === 'asset-meter-board')}
                      onChange={(event) => chooseMeterBoard(event.target.value)}
                    >
                      <option value="">Choose a switchboard</option>
                      {filteredMeterBoards.map((board) => {
                        const boardZone = tree.zones.find((item) => item.id === board.zoneId);
                        return <option key={board.id} value={board.id}>{board.assetName} · {boardTypeLabel(board)} · {boardZone?.zoneName || 'Unknown zone'}</option>;
                      })}
                    </Select>
                    <FieldError message={errors.find((item) => item.id === 'asset-meter-board')?.message} />
                    <FieldHint>Choose only from the asset’s confirmed electrical supply path.</FieldHint>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {directSupplyBoardId ? (
                        <Button
                          variant="secondary"
                          onClick={() => chooseMeterBoard(directSupplyBoardId)}
                          disabled={busy || quickBoardBusy}
                        >
                          Use supplying switchboard
                        </Button>
                      ) : null}
                      <Button variant="secondary" onClick={() => openQuickBoard('METER_LOCATION')} disabled={busy || quickBoardBusy}>
                        <Icon name="plus" size={16} />Add and select a switchboard
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[var(--green)]/30 bg-[var(--green-soft)] p-3">
                    <p className="text-sm font-extrabold text-[var(--text)]">Meter location: same as supplying switchboard</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
                      {selectedSupplyBoard?.assetName} · {selectedSupplyBoard ? boardTypeLabel(selectedSupplyBoard) : ''}
                    </p>
                    <Button
                      variant="secondary"
                      className="mt-3"
                      onClick={() => setMeterLocationOverrideOpen(true)}
                      disabled={busy}
                    >
                      Installed on a different upstream switchboard
                    </Button>
                  </div>
                )}

                <FieldLabel htmlFor="asset-meter-search">{ASSET_METER_FILTER_LABEL}</FieldLabel>
                <Input
                  id="asset-meter-search"
                  type="search"
                  value={meterSearch}
                  disabled={!draft.meterSwitchboardId}
                  placeholder="Filter by name, model, serial, or stable ID"
                  onChange={(event) => setMeterSearch(event.target.value)}
                />
                <FieldHint>{ASSET_METER_FILTER_HINT}</FieldHint>
                <FieldLabel htmlFor="asset-meter">Exact metering device *</FieldLabel>
                <Select
                  id="asset-meter"
                  value={draft.meterId ?? ''}
                  disabled={!draft.meterSwitchboardId}
                  aria-invalid={errors.some((item) => item.id === 'asset-meter')}
                  onChange={(event) => chooseMeter(event.target.value)}
                >
                  <option value="">Choose a device</option>
                  {availableMeters.map((meter) => <option key={meter.id} value={meter.id}>{meter.serialNumber || 'No device ID'} · {humanDeviceName(meter)}</option>)}
                </Select>
                <FieldError message={errors.find((item) => item.id === 'asset-meter')?.message} />
                <FieldHint>Showing {availableMeters.length} of {eligibleMeters.length} eligible devices. Refine the search to reach any device; the current selection remains visible.</FieldHint>
                {draft.meterSwitchboardId && availableMeters.length === 0 ? (
                  <FieldHint>No active metering devices are installed on this switchboard.</FieldHint>
                ) : null}
                {draft.meterSwitchboardId ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button variant="secondary" disabled={Boolean(detourHref) || detourBusy || busy} onClick={() => void addDeviceToMeterBoard()}>
                      <Icon name="plus" size={16} />{detourHref || detourBusy ? 'Opening meter options…' : 'Add a new meter'}
                    </Button>
                    <p className="text-xs leading-5 text-[var(--text-sub)]">Opens the full WW installation form. After commissioning, this asset draft returns so you can select the new device’s exact channels.</p>
                  </div>
                ) : null}

                <ChoiceGroup<PhaseMode>
                  label="How many phases does this asset use?"
                  hint="This choice sets the exact number of meter channels required below."
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
                  <legend className="text-sm font-bold text-[var(--text)]">Measured channels *</legend>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Select the physical channel or channels wired to this asset. The count must match the phase choice above. Occupied channels show their exact attachment and can be reassigned when the existing target is another site asset.</p>
                  <p id="asset-channel-group-status" className="mt-1 text-xs font-semibold text-[var(--text-sub)]" role="status" aria-live="polite" aria-atomic="true">{channelGroupAnnouncement}</p>
                  {!selectedMeter ? <p className="mt-3 text-sm text-[var(--text-sub)]">Choose a device to see its channels.</p> : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {selectedMeter.channels.map((channel) => {
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
                  <FieldError message={errors.find((item) => item.id === 'asset-channels')?.message} />
                </fieldset>
              </div>
            ) : null}
            {meteringState.kind === 'UNMETERED' ? <InlineNotice>This asset is intentionally retained in the full asset register without a direct channel assignment.</InlineNotice> : null}
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
          'This channel will be selected here; choose any other required phase channels before saving',
        ]}
        confirmLabel="Approve reassignment"
        blockedMessage={tree.installation.status === 'Completed' ? 'Reopen this completed installation before reassigning channels.' : undefined}
        onConfirm={approveChannelTakeover}
        onCancel={() => setPendingChannelTakeover(null)}
      />

      <ConfirmDialog
        open={quickBoardOpen}
        title={quickBoardPurpose === 'METER_LOCATION' ? 'Add an upstream meter switchboard' : 'Add a switchboard'}
        description={quickBoardPurpose === 'METER_LOCATION' && directSupplyBoardId
          ? 'The new switchboard will be inserted upstream of the supplying switchboard. The asset’s direct supply will stay unchanged, and the new upstream board will be selected as the meter location.'
          : 'The new switchboard will be added in this asset’s physical zone, inherit the asset’s current upstream supply, and be selected when you return to this form.'}
        confirmLabel="Add and select switchboard"
        danger={false}
        busy={quickBoardBusy}
        onConfirm={() => void addQuickBoard()}
        onCancel={() => {
          setQuickBoardOpen(false);
          setQuickBoardError('');
          setQuickBoardCustomTypeError('');
        }}
      >
        <div className="grid gap-x-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="quick-board-name" className="mt-0">Switchboard name *</FieldLabel>
            <Input
              id="quick-board-name"
              value={quickBoardName}
              autoFocus
              maxLength={ENTITY_NAME_MAX_LENGTH}
              aria-invalid={Boolean(quickBoardError)}
              onChange={(event) => {
                setQuickBoardName(event.target.value);
                setQuickBoardError('');
              }}
            />
            <FieldError message={quickBoardError} />
          </div>
          <div>
            <FieldLabel htmlFor="quick-board-type" className="mt-0">Switchboard type *</FieldLabel>
            <Select id="quick-board-type" value={quickBoardType} onChange={(event) => {
              const nextType = event.target.value;
              setQuickBoardName((current) => nameAfterTypeChange(
                current,
                defaultBoardName(quickBoardType, quickBoardCustomType),
                defaultBoardName(nextType, nextType === 'OTHER' ? quickBoardCustomType : null),
              ));
              setQuickBoardType(nextType);
              setQuickBoardCustomTypeError('');
            }}>
              {BOARD_TYPE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </Select>
          </div>
          {quickBoardType === 'OTHER' ? (
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="quick-board-custom-type">Custom switchboard type *</FieldLabel>
              <Input
                id="quick-board-custom-type"
                value={quickBoardCustomType}
                aria-invalid={Boolean(quickBoardCustomTypeError)}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuickBoardName((current) => nameAfterTypeChange(
                    current,
                    defaultBoardName('OTHER', quickBoardCustomType),
                    defaultBoardName('OTHER', value),
                  ));
                  setQuickBoardCustomType(value);
                  setQuickBoardCustomTypeError('');
                }}
              />
              <FieldError message={quickBoardCustomTypeError} />
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
        title="Change metering to Unmetered?"
        description="The exact active meter and channel relationship will be removed from this asset."
        consequences={[
          `${draft.meterChannelIds?.length || existingAssignment?.channelIds.length || 0} assigned channel${(draft.meterChannelIds?.length || existingAssignment?.channelIds.length || 0) === 1 ? '' : 's'} will be released`,
          draft.meterId ? `Meter ${draft.meterId} will remain in the active device register` : 'The metering device remains unchanged',
          'The asset will remain in the register as confirmed unmetered',
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
        <InlineNotice>Save the site asset first, then add evidence.</InlineNotice>
      ) : (
        <Card id="asset-evidence" tabIndex={-1} className="scroll-mt-4">
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
      )}
    </div>
  );
}
