'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed meter editor from its server query record */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldError, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, InlineNotice, RecordNavigation } from '@/modules/installhub/components/InstallHubUi';
import { ScannerInput } from '@/modules/installhub/components/ScannerInput';
import { SearchableSelect } from '@/modules/installhub/components/SearchableSelect';
import {
  ConfirmDialog,
  ErrorSummary,
  SaveStateNotice,
  TreeDraftNavigationGuard,
  requestTreeNavigation,
} from '@/modules/installhub/components/WorkflowUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { uploadInstallationPhoto } from '@/modules/installhub/api/installhub';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import { createMeter, createSiteAsset, nowIso } from '@/modules/installhub/lib/model';
import {
  defaultCustomNameForType,
  defaultMeterCustomName,
  ENTITY_NAME_MAX_LENGTH,
  nameAfterTypeChange,
  provisionalDisplayCodeV3,
} from '@/modules/installhub/lib/naming';
import type {
  InstallationTree,
  Meter,
  MeasurementAssignment,
  SiteAsset,
  WattwatcherCommissioning,
  WattwatcherPrestart,
  WattwatcherSwitchboard,
  WattwatcherVerification,
} from '@/modules/installhub/types/domain';
import {
  CHANNEL_PURPOSE_OPTIONS,
  SITE_ASSET_TYPE_OPTIONS,
  applyAssetElectricalSource,
  assignmentForAsset,
  assetElectricalSource,
  boardTypeLabel,
  boardSupplyPath,
  measurementAssignments,
  meterChannelId,
  meterDependencyPreview,
  meterEditorHasChanges,
  legacySiteAssetType,
  reachableGridSuppliesForBoard,
  replaceMeterAssignments,
  syncMeterDevice,
  siteAssetTypeLabel,
} from '@/modules/installhub/lib/workflow';
import { createInstallHubId } from '@/modules/installhub/lib/id';
import {
  assetMeterReturnHref,
  assetMeterReturnRequest,
  measurementTargetDetails,
  type AssetMeterReturnRequest,
} from '@/modules/installhub/lib/electricalPresentation';
import { useToast } from '@/contexts/ToastContext';
import { createReplacementForm, humanDeviceName } from '@/modules/installhub/lib/deviceSearch';
import {
  assignmentApprovalSignature,
  assignmentCollectionConcurrencySignature,
  meterStructuralConcurrencySignature,
  nextMeterChannelId,
  renamedMeterCapabilities,
  showsWattwatchersCommissioningSections,
  structurallySavableMeterAssignments,
} from '@/modules/installhub/lib/meterPresentation';

const prestartQuestions: Array<[keyof WattwatcherPrestart, string]> = [
  ['siteInduction', 'Site induction required?'],
  ['safeAccess', 'Safe access?'],
  ['correctPpe', 'Correct PPE?'],
  ['livePointsAware', 'Aware of LIVE points?'],
  ['canIsolate', 'Can isolate power?'],
  ['additionalHazards', 'Additional hazards?'],
  ['safeToProceed', 'Safe to proceed?'],
];
const verificationQuestions: Array<[keyof WattwatcherVerification, string]> = [
  ['voltageChecked', 'Voltage checked'],
  ['polarityChecked', 'Polarity checked'],
  ['communicationsOk', 'Communications confirmed'],
];
const commissioningQuestions: Array<[keyof WattwatcherCommissioning, string]> = [
  ['deviceOnline', 'Device online'],
  ['channelsReporting', 'Channels reporting'],
  ['labeled', 'Device and channels labeled'],
  ['photosTaken', 'Commissioning photos taken'],
];
const LOAD_TYPES = [
  'Mains Supply',
  'HVAC',
  'Lighting',
  'Solar PV',
  'Forklift Charger',
  'Hot Water',
  'General Power',
  'Other',
  'Not Used',
] as const;
const ROGOWSKI_SIZES = [
  '10cm-200A',
  '10cm-333mV',
  '20cm-3000A',
  '30cm-3000A',
  '45cm-3000A',
  'Not Used',
] as const;
const CT_RATINGS = [
  'CT-60A',
  'CT-120A',
  'CT-250A',
  'CT-400A',
  'CT-600A',
  'Not Used',
] as const;
const SIGNAL_STRENGTHS = ['Low', 'Medium', 'High'] as const;
const ANTENNA_TYPES = [
  'Internal',
  'External',
  'CSM550 - External High Gain',
  'Other',
] as const;
const METER_CLASSIFICATIONS = [
  'Utility / Gate Meter',
  'Sub-meter',
  'Check Meter',
  'Solar / Generation Meter',
  'Other',
] as const;
const METER_COVERAGE_OPTIONS = [
  'Entire Board Load',
  'Specific Outgoing Circuit',
  'Multiple Circuits',
  'Unknown',
] as const;

type AssetQuickAddRequest = {
  assignmentId?: string;
  channelId?: string;
};

type MeterEditorBaseline = {
  meter: Meter | null;
  assignments: MeasurementAssignment[];
};

function withLegacyOption(
  options: readonly string[],
  current?: string,
): string[] {
  if (!current || options.includes(current)) return [...options];
  return [current, ...options];
}

function defaultMeterNameForDraft(meter: Meter): string {
  return defaultMeterCustomName({
    deviceModel: meter.deviceType,
    customManufacturerName: meter.customManufacturerName,
    customModelName: meter.customModelName,
  });
}

export function InstallHubMeterPage({
  mode,
  initialDeviceType = 'A3RM',
}: {
  mode: 'new' | 'edit';
  initialDeviceType?: Meter['deviceType'];
}) {
  const { installationId, zoneId, boardId, meterId } = useParams<{
    installationId: string;
    zoneId: string;
    boardId: string;
    meterId?: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const { user } = useInstallHubAuth();
  const [draft, setDraft] = useState<Meter | null>(null);
  const [busy, setBusy] = useState(false);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Array<{ id?: string; message: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<MeasurementAssignment[]>([]);
  const initializedEditorRef = useRef('');
  const [editorBaseline, setEditorBaseline] = useState<MeterEditorBaseline | null>(null);
  const pendingWriteKindRef = useRef<'save' | 'evidence' | null>(null);
  const [pendingAssetRemap, setPendingAssetRemap] = useState<{
    assignmentId: string;
    siteAssetId: string;
    existingAssignment: MeasurementAssignment;
  } | null>(null);
  const [approvedCrossMeterAssignments, setApprovedCrossMeterAssignments] = useState<Map<string, string>>(new Map());
  const [pendingDraftChannelMove, setPendingDraftChannelMove] = useState<{
    fromAssignmentId: string;
    toAssignmentId: string;
    channelId: string;
  } | null>(null);
  const [assetReturn, setAssetReturn] = useState<AssetMeterReturnRequest | null>(null);
  const [stagedAssets, setStagedAssets] = useState<SiteAsset[]>([]);
  const [assetQuickAdd, setAssetQuickAdd] = useState<AssetQuickAddRequest | null>(null);
  const [quickAssetZoneId, setQuickAssetZoneId] = useState('');
  const [quickAssetTypeCode, setQuickAssetTypeCode] = useState('HVAC');
  const [quickAssetName, setQuickAssetName] = useState(
    defaultCustomNameForType(SITE_ASSET_TYPE_OPTIONS, 'HVAC'),
  );
  const [quickAssetCustomType, setQuickAssetCustomType] = useState('');
  const [quickAssetErrors, setQuickAssetErrors] = useState<Array<{ id?: string; message: string }>>([]);

  useEffect(() => {
    if (mode !== 'new') return;
    setAssetReturn(assetMeterReturnRequest(new URLSearchParams(window.location.search)));
  }, [mode]);

  const board = query.data?.electricalAssets.find((item) => item.id === boardId);
  const source = board?.meters.find((item) => item.id === meterId);
  const canonicalSource = query.data?.meterDevices?.find((item) => item.id === meterId);
  useEffect(() => {
    const editorKey = `${mode}:${installationId}:${boardId}:${meterId || initialDeviceType}`;
    if (initializedEditorRef.current === editorKey) return;
    if (mode === 'new') {
      if (!board) return;
      const created = createMeter();
      const boardContext = {
        name: board.assetName,
        location: board.locationDescription?.trim()
          || query.data?.zones.find((item) => item.id === board.zoneId)?.zoneName
          || '',
      };
      setDraft(initialDeviceType !== 'Other' ? { ...created, wwSwitchboard: boardContext } : {
        ...created,
        deviceFamily: 'OTHER',
        deviceType: 'Other',
        customName: defaultMeterCustomName({ deviceModel: 'Other' }),
        deviceName: defaultMeterCustomName({ deviceModel: 'Other' }),
        customManufacturerName: '',
        customModelName: '',
        wwSwitchboard: boardContext,
        wwChannels: [{
          id: meterChannelId(created.id, 0),
          ordinal: 1,
          purpose: 'SPARE',
          capabilities: {},
        }],
      });
      setAssignmentDrafts([]);
      setEditorBaseline({ meter: null, assignments: [] });
    } else if (source) {
      setDraft({
        ...structuredClone(source),
        customName: source.customName || canonicalSource?.customName,
      });
      const sourceAssignments = measurementAssignments(query.data!).filter(
          (assignment) => assignment.meterId === source.id,
        ).map((assignment) => structuredClone(assignment));
      setAssignmentDrafts(sourceAssignments);
      setEditorBaseline({
        meter: structuredClone(source),
        assignments: structuredClone(sourceAssignments),
      });
    } else return;
    setStagedAssets([]);
    setApprovedCrossMeterAssignments(new Map());
    initializedEditorRef.current = editorKey;
  }, [board, boardId, canonicalSource?.customName, initialDeviceType, installationId, meterId, mode, query.data, source]);

  if (query.isLoading || !draft) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!board) return <ErrorBanner message="Switchboard not found." />;
  if (mode === 'edit' && !source && !editorBaseline?.meter) return <ErrorBanner message="Meter not found." />;
  const tree = query.data!;
  const zone = tree.zones.find((item) => item.id === zoneId);
  const saved = mode === 'edit';
  const currentDraft = draft;
  const fixedOtherWorkflow = mode === 'edit' && source?.deviceType === 'Other';
  const showWattwatchersSections = showsWattwatchersCommissioningSections(
    draft.deviceType,
  );
  const latestBoard = tree.electricalAssets.find((item) => item.id === boardId)!;
  const latest = latestBoard.meters.find((item) => item.id === meterId) ?? draft;
  const commissionedForm = tree.formSubmissions.find(
    (form) =>
      form.formType === 'ww-installation' &&
      form.status === 'Completed' &&
      (form.meterId === draft.id || (
        !form.meterId &&
        form.boardId === boardId &&
        form.answers['existing.device_id'] === draft.deviceId
      )),
  );
  const dependencyPreview = meterDependencyPreview(tree, draft.id);
  const defaultDeviceCustomName = defaultMeterCustomName({
    deviceModel: draft.deviceType,
    customManufacturerName: draft.customManufacturerName,
    customModelName: draft.customModelName,
  });
  const visibleDeviceName = draft.customName?.trim()
    || canonicalSource?.customName?.trim()
    || defaultDeviceCustomName;
  const previewDisplayName = provisionalDisplayCodeV3(tree, {
    zoneId: board.zoneId,
    customName: visibleDeviceName,
    fallbackType: defaultDeviceCustomName,
    entityKind: 'meter',
    entityTypeCode: draft.deviceType,
    excludeId: draft.id,
    current: canonicalSource?.displayName,
  });
  const quickAssetPreview = quickAssetZoneId && tree.zones.some((item) => item.id === quickAssetZoneId)
    ? provisionalDisplayCodeV3({
        ...tree,
        siteAssets: [...tree.siteAssets, ...stagedAssets],
      }, {
        zoneId: quickAssetZoneId,
        customName: quickAssetName,
        fallbackType: defaultCustomNameForType(
          SITE_ASSET_TYPE_OPTIONS,
          quickAssetTypeCode,
          quickAssetCustomType,
        ),
        entityKind: 'site_asset',
        entityTypeCode: quickAssetTypeCode,
      })
    : null;
  const hasLocalChanges = meterEditorHasChanges(
    draft,
    editorBaseline?.meter ?? undefined,
    assignmentDrafts,
    editorBaseline?.assignments ?? [],
    mode,
  ) || stagedAssets.length > 0 || (mode === 'edit' && !source && Boolean(editorBaseline?.meter));

  function adoptConfirmedMeterEditor(confirmed: InstallationTree): boolean {
    const confirmedMeter = confirmed.electricalAssets
      .find((item) => item.id === boardId)
      ?.meters.find((item) => item.id === currentDraft.id);
    if (!confirmedMeter) return false;
    const confirmedCanonicalMeter = confirmed.meterDevices?.find(
      (item) => item.id === currentDraft.id,
    );
    const confirmedAssignments = measurementAssignments(confirmed)
      .filter((assignment) => assignment.meterId === currentDraft.id)
      .map((assignment) => structuredClone(assignment));
    setDraft({
      ...structuredClone(confirmedMeter),
      customName: confirmedMeter.customName || confirmedCanonicalMeter?.customName,
    });
    setAssignmentDrafts(confirmedAssignments);
    setStagedAssets([]);
    setApprovedCrossMeterAssignments(new Map());
    setPendingAssetRemap(null);
    setPendingDraftChannelMove(null);
    setAssetQuickAdd(null);
    setErrors([]);
    setQuickAssetErrors([]);
    setEditorBaseline({
      meter: structuredClone(confirmedMeter),
      assignments: structuredClone(confirmedAssignments),
    });
    return true;
  }

  async function retryTreeWrite() {
    try {
      const pendingWriteKind = pendingWriteKindRef.current;
      const retried = await writer.retry();
      if (!retried) {
        pendingWriteKindRef.current = null;
        return;
      }
      if (pendingWriteKind === 'evidence') {
        updateEditorEvidenceBaseline(retried);
        pendingWriteKindRef.current = null;
        return;
      }
      const meterExists = retried.electricalAssets
        .find((item) => item.id === boardId)
        ?.meters.some((item) => item.id === currentDraft.id);
      if (mode === 'new' && meterExists) {
        pendingWriteKindRef.current = null;
        router.replace(assetReturn
          ? assetMeterReturnHref(installationId, assetReturn, currentDraft.id)
          : `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/${currentDraft.id}`);
        return;
      }
      if (mode === 'edit' && !adoptConfirmedMeterEditor(retried)) {
        throw new Error('The meter is no longer present in the latest installation.');
      }
      pendingWriteKindRef.current = null;
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function discardTreeWrite() {
    try {
      await writer.discard();
      pendingWriteKindRef.current = null;
      if (mode === 'new') {
        router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}`);
        return;
      }
      const confirmed = (await query.refetch()).data;
      if (!confirmed || !adoptConfirmedMeterEditor(confirmed)) {
        throw new Error('The latest confirmed meter could not be loaded.');
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  function updateEditorEvidenceBaseline(confirmed: InstallationTree) {
    const confirmedMeter = confirmed.electricalAssets
      .find((item) => item.id === boardId)
      ?.meters.find((item) => item.id === currentDraft.id) ?? null;
    setEditorBaseline((baseline) => baseline?.meter && confirmedMeter
      ? {
          meter: {
            ...baseline.meter,
            wwPhotos: structuredClone(confirmedMeter.wwPhotos),
          },
          assignments: baseline.assignments,
        }
      : baseline);
    if (confirmedMeter) {
      setDraft((current) => current ? {
        ...current,
        wwPhotos: structuredClone(confirmedMeter.wwPhotos),
      } : current);
    }
  }

  async function startReplacement() {
    if (writer.hasPendingTree) {
      toast.error('Retry or discard the pending meter write before starting a replacement.');
      return;
    }
    if (!user || !meterId) {
      toast.error('Sign in before starting a replacement.');
      return;
    }
    if (hasLocalChanges) {
      toast.error('Save or discard the current device edits before starting its replacement.');
      return;
    }
    setReplacementBusy(true);
    try {
      let formId = '';
      await writer.mutate((next) => {
        formId = createReplacementForm(next, user, {
          zoneId,
          boardId,
          meterId,
        }).id;
      }, 'metadata');
      toast.success('Replacement form created with this device selected.');
      router.push(`/installhub/installations/${installationId}/forms/${formId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
      setReplacementBusy(false);
    }
  }
  const reachableGridSupplies = reachableGridSuppliesForBoard(tree, boardId);

  function set<K extends keyof Meter>(key: K, value: Meter[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function setPrestart(key: keyof WattwatcherPrestart, value: boolean) {
    set('wwPrestart', { ...currentDraft.wwPrestart, [key]: value });
  }

  function setSwitchboard(key: keyof WattwatcherSwitchboard, value: string) {
    set('wwSwitchboard', { ...currentDraft.wwSwitchboard, [key]: value });
  }

  function setVerification(key: keyof WattwatcherVerification, value: boolean | string) {
    set('wwVerification', { ...currentDraft.wwVerification, [key]: value });
  }

  function setCommissioning(key: keyof WattwatcherCommissioning, value: boolean | string) {
    set('wwCommissioning', { ...currentDraft.wwCommissioning, [key]: value });
  }

  function setMeterIdentityDetail(
    key: 'customManufacturerName' | 'customModelName',
    value: string,
  ) {
    setDraft((current) => {
      if (!current) return current;
      const previousDefault = defaultMeterNameForDraft(current);
      const next = { ...current, [key]: value };
      return {
        ...next,
        customName: nameAfterTypeChange(
          current.customName || '',
          previousDefault,
          defaultMeterNameForDraft(next),
        ),
      };
    });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const nextErrors: Array<{ id?: string; message: string }> = [];
    if (visibleDeviceName.trim().length > ENTITY_NAME_MAX_LENGTH) nextErrors.push({ id: 'meter-name', message: `Use ${ENTITY_NAME_MAX_LENGTH} characters or fewer for the device name.` });
    const channels = currentDraft.wwChannels || [];
    const purposeByChannelId = new Map(channels.map((channel, index) => [
      channel.id || meterChannelId(currentDraft.id, index),
      channel.purpose || 'SPARE',
    ]));
    const usedSiteAssetTargets = new Set<string>();
    const availableBoardTargetIds = new Set(tree.electricalAssets.map((candidate) => candidate.id));
    const allSiteAssetTargets = [...tree.siteAssets, ...stagedAssets];
    const availableSiteAssetTargetIds = new Set(allSiteAssetTargets
      .filter((candidate) => {
        const source = assetElectricalSource(candidate);
        return source.kind === 'BOARD' && source.boardId === boardId;
      })
      .map((candidate) => candidate.id));
    const availableGridTargetIds = new Set((tree.gridSupplies || []).map((candidate) => candidate.id));
    const assignmentsToSave = structurallySavableMeterAssignments(
      structuredClone(assignmentDrafts),
      channels,
    ).map((assignment, index) => {
      let normalizeToTbc = assignment.target.kind === 'TBC';
      const channelIds = assignment.channelIds;
      const purposes = new Set(channelIds.map((channelId) => purposeByChannelId.get(channelId)));
      if (purposes.size !== 1 || purposes.has('SPARE') || purposes.has(undefined)) normalizeToTbc = true;
      const purpose = purposes.size === 1 ? [...purposes][0] : undefined;
      if (purpose === 'MAIN_SUPPLY' && !['BOARD', 'GRID_BOUNDARY', 'TBC'].includes(assignment.target.kind)) {
        normalizeToTbc = true;
      }
      if (purpose === 'MAIN_SUPPLY' && assignment.target.kind === 'BOARD' && assignment.target.boardId !== boardId) {
        normalizeToTbc = true;
      }
      if (purpose === 'SUB_CIRCUIT' && assignment.target.kind === 'GRID_BOUNDARY') {
        normalizeToTbc = true;
      }
      if (purpose === 'SUB_CIRCUIT' && assignment.target.kind === 'BOARD' && (
        assignment.target.boardId === boardId
        || !boardSupplyPath(tree, assignment.target.boardId).includes(boardId)
      )) {
        normalizeToTbc = true;
      }
      if (assignment.target.kind === 'BOARD' && (
        !assignment.target.boardId
        || !availableBoardTargetIds.has(assignment.target.boardId)
      )) {
        normalizeToTbc = true;
      }
      if (assignment.target.kind === 'SITE_ASSET' && (
        !assignment.target.siteAssetId
        || usedSiteAssetTargets.has(assignment.target.siteAssetId)
      )) {
        normalizeToTbc = true;
      }
      if (assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId) {
        const baselineAssignment = editorBaseline?.assignments.find((candidate) => (
          candidate.id === assignment.id
        ));
        const unchangedHistoricalTarget = !availableSiteAssetTargetIds.has(assignment.target.siteAssetId)
          && baselineAssignment !== undefined
          && assignmentApprovalSignature(baselineAssignment) === assignmentApprovalSignature(assignment);
        if (!availableSiteAssetTargetIds.has(assignment.target.siteAssetId) && !unchangedHistoricalTarget) {
          normalizeToTbc = true;
        }
      }
      if (assignment.target.kind === 'GRID_BOUNDARY' && (
        !assignment.target.gridSupplyId
        || !availableGridTargetIds.has(assignment.target.gridSupplyId)
      )) {
        normalizeToTbc = true;
      } else if (assignment.target.kind === 'GRID_BOUNDARY') {
        const gridSupplyId = assignment.target.gridSupplyId;
        if (!reachableGridSupplies.some((supply) => supply.id === gridSupplyId)) {
          normalizeToTbc = true;
        }
      }
      if (!normalizeToTbc && assignment.target.kind === 'SITE_ASSET') {
        const existingAssignment = assignmentForAsset(tree, assignment.target.siteAssetId);
        if (
          existingAssignment
          && existingAssignment.meterId !== currentDraft.id
          && approvedCrossMeterAssignments.get(existingAssignment.id) !== assignmentApprovalSignature(existingAssignment)
        ) {
          nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'This site asset is already measured by another meter. Approve the explicit reassignment first.' });
        }
        usedSiteAssetTargets.add(assignment.target.siteAssetId);
      }
      return {
        ...assignment,
        channelIds,
        ...(normalizeToTbc
          ? { target: { kind: 'TBC' as const }, status: 'TBC' as const }
          : { status: 'CONFIRMED' as const }),
      };
    });
    setErrors(nextErrors);
    if (nextErrors.length) {
      document.getElementById(nextErrors[0].id || '')?.focus();
      toast.error('Check the highlighted metering fields.');
      return;
    }
    const stagedAssetsToSave = structuredClone(stagedAssets);
    const approvedCrossMeterAssignmentsToSave = new Map(approvedCrossMeterAssignments);
    setBusy(true);
    pendingWriteKindRef.current = 'save';
    try {
      await writer.mutate((next) => {
        const targetBoard = next.electricalAssets.find((item) => item.id === boardId);
        if (!targetBoard) throw new Error('Switchboard not found.');
        const freshSource = targetBoard.meters.find((item) => item.id === currentDraft.id);
        const baseline = editorBaseline;
        const freshAssignments = measurementAssignments(next)
          .filter((assignment) => assignment.meterId === currentDraft.id);
        if (mode === 'edit' && (
          !baseline?.meter
          || meterStructuralConcurrencySignature(freshSource) !== meterStructuralConcurrencySignature(baseline.meter)
          || assignmentCollectionConcurrencySignature(freshAssignments) !== assignmentCollectionConcurrencySignature(baseline.assignments)
        )) {
          throw new Error('This meter or its channel mappings changed on the server after this editor opened. Your draft was not applied. Leave without discarding only after copying any values you still need, then reopen the meter and retry against the latest version.');
        }
        const editableDraft = commissionedForm && freshSource ? {
          ...structuredClone(freshSource),
          customName: currentDraft.customName,
          wwSwitchboard: { ...freshSource.wwSwitchboard, notes: currentDraft.wwSwitchboard?.notes },
          wwVerification: { ...freshSource.wwVerification, notes: currentDraft.wwVerification?.notes },
          wwCommissioning: { ...freshSource.wwCommissioning, notes: currentDraft.wwCommissioning?.notes },
          notes: currentDraft.notes,
        } : structuredClone(currentDraft);
        const editableChannels = editableDraft.wwChannels || [];
        const value: Meter = {
          ...editableDraft,
          customName: visibleDeviceName.trim(),
          deviceName: visibleDeviceName.trim(),
          deviceNameOverridden: editableDraft.deviceNameOverridden ?? false,
          deviceId: editableDraft.deviceId.trim(),
          deviceNumber: editableDraft.deviceNumber?.trim() || null,
          customManufacturerName: editableDraft.deviceFamily === 'OTHER' ? editableDraft.customManufacturerName?.trim() : null,
          customModelName: editableDraft.deviceType === 'Other' ? editableDraft.customModelName?.trim() : null,
          lifecycleState: 'ACTIVE',
          wwPhotos: freshSource?.wwPhotos ?? editableDraft.wwPhotos,
          wwChannels: editableChannels.map((channel, channelIndex) => {
            const purpose = channel.purpose || 'SPARE';
            const capabilities = Object.fromEntries(
              Object.entries(channel.capabilities || {}).map(([key, capabilityValue]) => [
                key.trim(),
                typeof capabilityValue === 'string' ? capabilityValue.trim() : capabilityValue,
              ]),
            );
            if (purpose === 'SPARE') {
              return {
                id: channel.id || meterChannelId(currentDraft.id, channelIndex),
                ordinal: channelIndex + 1,
                purpose: 'SPARE',
                capabilities,
              };
            }
            return {
              ...channel,
              id: channel.id || meterChannelId(currentDraft.id, channelIndex),
              ordinal: channelIndex + 1,
              purpose,
              capabilities,
              customLoadTypeName: channel.loadType === 'Other' ? channel.customLoadTypeName?.trim() : undefined,
            };
          }),
        };
        const index = targetBoard.meters.findIndex((item) => item.id === value.id);
        if (index >= 0) targetBoard.meters[index] = value;
        else targetBoard.meters.push(value);
        targetBoard.meterPresent = true;
        targetBoard.updatedAt = nowIso();
        syncMeterDevice(next, boardId, value);
        const referencedStagedAssetIds = new Set(assignmentsToSave.flatMap((assignment) => (
          assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []
        )));
        for (const staged of stagedAssetsToSave) {
          if (!referencedStagedAssetIds.has(staged.id)) continue;
          if (next.siteAssets.some((candidate) => candidate.id === staged.id)) continue;
          const inserted = structuredClone(staged);
          const display = provisionalDisplayCodeV3(next, {
            zoneId: inserted.zoneId,
            customName: inserted.assetName,
            fallbackType: defaultCustomNameForType(
              SITE_ASSET_TYPE_OPTIONS,
              inserted.typeCode || 'OTHER',
              inserted.customTypeName,
            ),
            entityKind: 'site_asset',
            entityTypeCode: inserted.typeCode || 'OTHER',
            excludeId: inserted.id,
          });
          inserted.displayCodeMeta = display;
          inserted.displayCode = display.value;
          inserted.updatedAt = nowIso();
          next.siteAssets.push(inserted);
        }
        const approvedConflictIds = [...new Set(assignmentsToSave.flatMap((assignment) => {
          if (assignment.target.kind !== 'SITE_ASSET') return [];
          const conflict = assignmentForAsset(next, assignment.target.siteAssetId);
          if (!conflict || conflict.meterId === currentDraft.id) return [];
          if (
            approvedCrossMeterAssignmentsToSave.get(conflict.id)
            !== assignmentApprovalSignature(conflict)
          ) {
            throw new Error('The current device or channel group for a selected site asset changed after reassignment was approved. Nothing was moved. Review and approve the exact current mapping again.');
          }
          return [conflict.id];
        }))];
        replaceMeterAssignments(next, value.id, assignmentsToSave, approvedConflictIds.length ? {
          crossMeterAssetRemapApproval: { assignmentIds: approvedConflictIds },
        } : undefined);
      });
      setErrors([]);
      pendingWriteKindRef.current = null;
      toast.success(saved ? 'Meter saved.' : 'Meter added.');
      router.replace(assetReturn
        ? assetMeterReturnHref(installationId, assetReturn, currentDraft.id)
        : `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadSingle(
    slot: 'deviceInstalled' | 'switchboardOverview' | 'labeling',
    files: File[],
  ) {
    if (writer.hasPendingTree) {
      toast.error('Retry or discard the pending meter write before changing evidence.');
      return;
    }
    const file = files[0];
    if (!file || !meterId) return;
    setUploading(true);
    pendingWriteKindRef.current = 'evidence';
    try {
      const confirmed = await writer.mutate(async (next) => {
        const targetBoard = next.electricalAssets.find((item) => item.id === boardId);
        if (!targetBoard) throw new Error('Switchboard not found.');
        const targetMeter = targetBoard.meters.find((item) => item.id === meterId);
        const targetDevice = next.meterDevices?.find((item) => item.id === meterId);
        if (!targetMeter || !targetDevice) throw new Error('Meter not found.');
        targetMeter.wwPhotos = targetMeter.wwPhotos ?? { extra: [] };
        const uri = await uploadInstallationPhoto(next, {
          installationId,
          entityType: 'meter_device',
          entityId: meterId,
          fieldName: `wwPhotos.${slot}`,
        }, file);
        targetMeter.wwPhotos[slot] = uri;
        targetDevice.wwPhotos = { ...(targetDevice.wwPhotos || {}), [slot]: uri };
        targetBoard.updatedAt = nowIso();
      });
      updateEditorEvidenceBaseline(confirmed);
      pendingWriteKindRef.current = null;
      toast.success('Meter evidence uploaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function uploadExtra(files: File[]) {
    if (writer.hasPendingTree) {
      toast.error('Retry or discard the pending meter write before changing evidence.');
      return;
    }
    if (!meterId) return;
    setUploading(true);
    pendingWriteKindRef.current = 'evidence';
    try {
      const confirmed = await writer.mutate(async (next) => {
        const targetBoard = next.electricalAssets.find((item) => item.id === boardId);
        if (!targetBoard) throw new Error('Switchboard not found.');
        const targetMeter = targetBoard.meters.find((item) => item.id === meterId);
        const targetDevice = next.meterDevices?.find((item) => item.id === meterId);
        if (!targetMeter || !targetDevice) throw new Error('Meter not found.');
        targetMeter.wwPhotos = targetMeter.wwPhotos ?? { extra: [] };
        targetMeter.wwPhotos.extra = targetMeter.wwPhotos.extra ?? [];
        const canonicalExtra = Array.isArray(targetDevice.wwPhotos?.extra)
          ? targetDevice.wwPhotos.extra.filter((item): item is string => typeof item === 'string')
          : [];
        for (const file of files) {
          const photoIndex = canonicalExtra.length;
          const uri = await uploadInstallationPhoto(next, {
            installationId,
            entityType: 'meter_device',
            entityId: meterId,
            fieldName: `wwPhotos.extra[${photoIndex}]`,
          }, file);
          canonicalExtra.push(uri);
          targetMeter.wwPhotos.extra.push(uri);
        }
        targetDevice.wwPhotos = { ...(targetDevice.wwPhotos || {}), extra: canonicalExtra };
        targetBoard.updatedAt = nowIso();
      });
      updateEditorEvidenceBaseline(confirmed);
      pendingWriteKindRef.current = null;
      toast.success(`${files.length} meter photo${files.length === 1 ? '' : 's'} uploaded.`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(
    slot: 'deviceInstalled' | 'switchboardOverview' | 'labeling' | 'extra',
    id?: string,
  ) {
    if (writer.hasPendingTree) {
      toast.error('Retry or discard the pending meter write before changing evidence.');
      return;
    }
    pendingWriteKindRef.current = 'evidence';
    try {
      const confirmed = await writer.mutate((next) => {
        const target = next.electricalAssets
          .find((item) => item.id === boardId)
          ?.meters.find((item) => item.id === meterId);
        const targetDevice = next.meterDevices?.find((item) => item.id === meterId);
        if (!target?.wwPhotos || !targetDevice) return;
        const canonicalPhotos = { ...(targetDevice.wwPhotos || {}) };
        if (slot === 'extra') {
          const photoIndex = Number(id);
          if (!Number.isInteger(photoIndex)) return;
          target.wwPhotos.extra = target.wwPhotos.extra?.filter(
            (_, index) => index !== photoIndex,
          );
          const existing = Array.isArray(canonicalPhotos.extra)
            ? canonicalPhotos.extra.filter((item): item is string => typeof item === 'string')
            : [];
          canonicalPhotos.extra = existing.filter((_, index) => index !== photoIndex);
        }
        else {
          target.wwPhotos[slot] = null;
          canonicalPhotos[slot] = null;
        }
        targetDevice.wwPhotos = canonicalPhotos;
      });
      updateEditorEvidenceBaseline(confirmed);
      pendingWriteKindRef.current = null;
      toast.success('Meter photo removed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeMeter() {
    if (writer.hasPendingTree) {
      toast.error('Retry or discard the pending meter write before removing this meter.');
      return;
    }
    if (!meterId) return;
    try {
      const result = await writer.removeMeter(
        meterId,
        tree.treeRevision ?? tree.baseTreeRevision ?? 0,
      );
      setConfirmDelete(false);
      const affected = result.meterRemoval.affectedSiteAssetIds.length;
      const assignments = result.meterRemoval.removedAssignmentIds.length;
      const versions = result.meterRemoval.retainedRecordVersions
        .map((item) => item.recordVersionNumber)
        .join(', ');
      toast.success(
        `Meter soft-deleted from the active register. ${assignments} assignment${assignments === 1 ? '' : 's'} removed; ${affected} site asset${affected === 1 ? '' : 's'} returned to TBC.${versions ? ` Commissioning evidence remains immutable in record version${result.meterRemoval.retainedRecordVersions.length === 1 ? '' : 's'} ${versions}.` : ''}`,
      );
      router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  function chooseDeviceFamily(value: 'WATTWATCHERS' | 'OTHER') {
    setDraft((current) => {
      if (!current) return current;
      if (value === 'WATTWATCHERS') {
        const deviceType = current.deviceType === 'A6M' ? 'A6M' : 'A3RM';
        const customName = nameAfterTypeChange(
          current.customName || '',
          defaultMeterNameForDraft(current),
          defaultMeterCustomName({ deviceModel: deviceType }),
        );
        const count = deviceType === 'A6M' ? 6 : 3;
        const channels = Array.from({ length: count }, (_, index) => ({
          ...(current.wwChannels?.[index] || {}),
          id: current.wwChannels?.[index]?.id || meterChannelId(current.id, index),
          ordinal: index + 1,
          purpose: current.wwChannels?.[index]?.purpose || 'SPARE',
        }));
        const validIds = new Set(channels.map((channel) => channel.id));
        setAssignmentDrafts((assignments) => assignments.map((assignment) => ({
          ...assignment,
          channelIds: assignment.channelIds.filter((id) => validIds.has(id)),
        })));
        return {
          ...current,
          deviceFamily: value,
          deviceType,
          customName,
          customManufacturerName: null,
          customModelName: null,
          wwChannels: channels,
        };
      }
      return {
        ...current,
        deviceFamily: value,
        deviceType: 'Other',
        customName: nameAfterTypeChange(
          current.customName || '',
          defaultMeterNameForDraft(current),
          defaultMeterCustomName({
            deviceModel: 'Other',
            customManufacturerName: current.customManufacturerName,
            customModelName: current.customModelName,
          }),
        ),
        wwChannels: current.wwChannels?.length ? current.wwChannels : [{ id: meterChannelId(current.id, 0), ordinal: 1, purpose: 'SPARE' }],
      };
    });
  }

  function chooseDeviceType(type: Meter['deviceType']) {
    setDraft((current) => {
      if (!current) return current;
      const count = type === 'A3RM' ? 3 : type === 'A6M' ? 6 : Math.max(1, current.wwChannels?.length || 1);
      const channels = Array.from({ length: count }, (_, index) => ({
        ...(current.wwChannels?.[index] || {}),
        id: current.wwChannels?.[index]?.id || meterChannelId(current.id, index),
        ordinal: index + 1,
        purpose: current.wwChannels?.[index]?.purpose || 'SPARE',
      }));
      const validIds = new Set(channels.map((channel) => channel.id));
      setAssignmentDrafts((assignments) => assignments.map((assignment) => ({
        ...assignment,
        channelIds: assignment.channelIds.filter((id) => validIds.has(id)),
      })));
      return {
        ...current,
        deviceFamily: type === 'Other' ? 'OTHER' : current.deviceFamily,
        deviceType: type,
        customName: nameAfterTypeChange(
          current.customName || '',
          defaultMeterNameForDraft(current),
          defaultMeterCustomName({
            deviceModel: type,
            customManufacturerName: current.customManufacturerName,
            customModelName: type === 'Other' ? current.customModelName : null,
          }),
        ),
        customModelName: type === 'Other' ? current.customModelName : null,
        wwChannels: channels,
      };
    });
  }

  function updateChannel(index: number, change: Partial<NonNullable<Meter['wwChannels']>[number]>) {
    setDraft((current) => {
      if (!current) return current;
      const channels = [...(current.wwChannels || [])];
      const before = channels[index] || { id: meterChannelId(current.id, index), ordinal: index + 1 };
      const purpose = change.purpose || before.purpose || 'SPARE';
      channels[index] = purpose === 'SPARE'
        ? {
            id: before.id || meterChannelId(current.id, index),
            ordinal: index + 1,
            purpose: 'SPARE',
            capabilities: change.capabilities || before.capabilities || {},
          }
        : { ...before, ...change, id: before.id || meterChannelId(current.id, index), ordinal: index + 1, purpose };
      if (purpose === 'SPARE') {
        const channelId = channels[index].id!;
        setAssignmentDrafts((assignments) => assignments.map((assignment) => ({
          ...assignment,
          channelIds: assignment.channelIds.filter((id) => id !== channelId),
        })));
      }
      return { ...current, wwChannels: channels };
    });
  }

  function addCustomChannel() {
    setDraft((current) => {
      if (!current) return current;
      const index = current.wwChannels?.length || 0;
      return {
        ...current,
        wwChannels: [...(current.wwChannels || []), {
          id: nextMeterChannelId(current.id, current.wwChannels || []),
          ordinal: index + 1,
          purpose: 'SPARE',
        }],
      };
    });
  }

  function removeCustomChannel(index: number) {
    const removedId = currentDraft.wwChannels?.[index]?.id || meterChannelId(currentDraft.id, index);
    setDraft((current) => {
      if (!current) return current;
      const channels = (current.wwChannels || []).filter((_, itemIndex) => itemIndex !== index).map((channel, itemIndex) => ({
        ...channel,
        ordinal: itemIndex + 1,
      }));
      return { ...current, wwChannels: channels };
    });
    setAssignmentDrafts((assignments) => assignments.map((assignment) => ({
      ...assignment,
      channelIds: assignment.channelIds.filter((id) => id !== removedId),
    })));
  }

  function setChannelCapabilities(index: number, capabilities: Record<string, unknown>) {
    updateChannel(index, { capabilities });
  }

  function renameCapability(index: number, priorKey: string, nextKey: string): boolean {
    const capabilities = { ...(currentDraft.wwChannels?.[index]?.capabilities || {}) };
    const result = renamedMeterCapabilities(capabilities, priorKey, nextKey);
    if (result.error) {
      toast.error(result.error);
      return false;
    }
    setChannelCapabilities(index, result.capabilities);
    return true;
  }

  function addCapability(index: number) {
    const capabilities = { ...(currentDraft.wwChannels?.[index]?.capabilities || {}) };
    let suffix = Object.keys(capabilities).length + 1;
    while (`capability_${suffix}` in capabilities) suffix += 1;
    capabilities[`capability_${suffix}`] = '';
    setChannelCapabilities(index, capabilities);
  }

  function addAssignment() {
    setAssignmentDrafts((current) => [...current, {
      id: createInstallHubId('assignment'),
      installationId,
      meterId: currentDraft.id,
      channelIds: [],
      phaseMode: 'SINGLE_PHASE',
      target: { kind: 'TBC' },
      direction: 'CONSUMPTION',
      status: 'TBC',
    }]);
  }

  function openAssetQuickAdd(request: AssetQuickAddRequest = {}) {
    if (busy) return;
    const defaultType = 'HVAC';
    setAssetQuickAdd(request);
    setQuickAssetZoneId(board!.zoneId);
    setQuickAssetTypeCode(defaultType);
    setQuickAssetName(defaultCustomNameForType(SITE_ASSET_TYPE_OPTIONS, defaultType));
    setQuickAssetCustomType('');
    setQuickAssetErrors([]);
  }

  function changeQuickAssetType(nextTypeCode: string) {
    const previousDefault = defaultCustomNameForType(
      SITE_ASSET_TYPE_OPTIONS,
      quickAssetTypeCode,
      quickAssetCustomType,
    );
    const nextDefault = defaultCustomNameForType(SITE_ASSET_TYPE_OPTIONS, nextTypeCode);
    setQuickAssetName((current) => nameAfterTypeChange(current, previousDefault, nextDefault));
    setQuickAssetTypeCode(nextTypeCode);
    if (nextTypeCode !== 'OTHER') setQuickAssetCustomType('');
  }

  function changeQuickAssetCustomType(nextCustomType: string) {
    const previousDefault = defaultCustomNameForType(
      SITE_ASSET_TYPE_OPTIONS,
      'OTHER',
      quickAssetCustomType,
    );
    const nextDefault = defaultCustomNameForType(
      SITE_ASSET_TYPE_OPTIONS,
      'OTHER',
      nextCustomType,
    );
    setQuickAssetName((current) => nameAfterTypeChange(current, previousDefault, nextDefault));
    setQuickAssetCustomType(nextCustomType);
  }

  function confirmQuickAsset() {
    if (!assetQuickAdd || busy) return;
    const nextErrors: Array<{ id?: string; message: string }> = [];
    if (!tree.zones.some((candidate) => candidate.id === quickAssetZoneId)) {
      nextErrors.push({ id: 'quick-asset-zone', message: 'Choose the physical zone where the asset is located.' });
    }
    if (quickAssetName.trim().length > ENTITY_NAME_MAX_LENGTH) {
      nextErrors.push({ id: 'quick-asset-name', message: `Use ${ENTITY_NAME_MAX_LENGTH} characters or fewer for the site asset name.` });
    }
    setQuickAssetErrors(nextErrors);
    if (nextErrors.length) {
      document.getElementById(nextErrors[0].id || '')?.focus();
      return;
    }

    const namingTree = structuredClone(tree);
    namingTree.siteAssets.push(...structuredClone(stagedAssets));
    const created = createSiteAsset(installationId, quickAssetZoneId);
    created.assetName = quickAssetName.trim() || defaultCustomNameForType(
      SITE_ASSET_TYPE_OPTIONS,
      quickAssetTypeCode,
      quickAssetCustomType,
    );
    created.typeCode = quickAssetTypeCode;
    created.assetType = legacySiteAssetType(quickAssetTypeCode);
    created.customTypeName = quickAssetTypeCode === 'OTHER' ? quickAssetCustomType.trim() : null;
    applyAssetElectricalSource(created, { kind: 'BOARD', boardId });
    created.displayCodeMeta = provisionalDisplayCodeV3(namingTree, {
      zoneId: created.zoneId,
      customName: created.assetName,
      fallbackType: defaultCustomNameForType(
        SITE_ASSET_TYPE_OPTIONS,
        created.typeCode,
        created.customTypeName,
      ),
      entityKind: 'site_asset',
      entityTypeCode: created.typeCode,
      excludeId: created.id,
    });
    created.displayCode = created.displayCodeMeta.value;
    setStagedAssets((current) => [...current, created]);
    setAssignmentDrafts((current) => {
      const existingIndex = assetQuickAdd.assignmentId
        ? current.findIndex((assignment) => assignment.id === assetQuickAdd.assignmentId)
        : -1;
      if (existingIndex >= 0) {
        return current.map((assignment, index) => index === existingIndex ? {
          ...assignment,
          target: { kind: 'SITE_ASSET', siteAssetId: created.id },
          status: 'CONFIRMED',
        } : assignment);
      }
      return [...current, {
        id: createInstallHubId('assignment'),
        installationId,
        meterId: currentDraft.id,
        channelIds: assetQuickAdd.channelId ? [assetQuickAdd.channelId] : [],
        phaseMode: 'SINGLE_PHASE',
        target: { kind: 'SITE_ASSET', siteAssetId: created.id },
        direction: 'CONSUMPTION',
        status: 'CONFIRMED',
      }];
    });
    setAssetQuickAdd(null);
    setQuickAssetErrors([]);
    window.setTimeout(() => document.getElementById('meter-assignments')?.focus(), 0);
  }

  function assignmentBoardCandidates(assignment: MeasurementAssignment) {
    const purpose = assignmentPurpose(assignment);
    return tree.electricalAssets
      .filter((item) => purpose === 'MAIN_SUPPLY'
        ? item.id === boardId
        : purpose === 'SUB_CIRCUIT'
          ? item.id !== boardId && boardSupplyPath(tree, item.id).includes(boardId)
          : item.id === boardId || boardSupplyPath(tree, item.id).includes(boardId))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function assignmentAssetCandidates(assignment: MeasurementAssignment) {
    const selectedId = assignment.target.kind === 'SITE_ASSET' ? assignment.target.siteAssetId : '';
    return [...tree.siteAssets, ...stagedAssets]
      .filter((item) => {
        if (item.id === selectedId) return true;
        const source = assetElectricalSource(item);
        return source.kind === 'BOARD' && source.boardId === boardId;
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function isHistoricalOffBoardAssignment(assignment: MeasurementAssignment): boolean {
    if (assignment.target.kind !== 'SITE_ASSET') return false;
    const siteAssetId = assignment.target.siteAssetId;
    const target = tree.siteAssets.find((item) => item.id === siteAssetId);
    if (!target) return false;
    const source = assetElectricalSource(target);
    if (source.kind === 'BOARD' && source.boardId === boardId) return false;
    const baselineAssignment = editorBaseline?.assignments.find((candidate) => (
      candidate.id === assignment.id
    ));
    return baselineAssignment !== undefined
      && assignmentApprovalSignature(baselineAssignment) === assignmentApprovalSignature(assignment);
  }

  function draftMeasurementTargetDetails(target: MeasurementAssignment['target']) {
    if (target.kind === 'SITE_ASSET') {
      const staged = stagedAssets.find((item) => item.id === target.siteAssetId);
      if (staged) {
        const code = staged.displayCodeMeta?.value || staged.displayCode || null;
        return {
          kind: target.kind,
          id: staged.id,
          name: staged.assetName,
          code,
          label: code ? `${code} — ${staged.assetName}` : staged.assetName,
          href: null,
        };
      }
    }
    return measurementTargetDetails(tree, target);
  }

  function updateAssignment(index: number, change: Partial<MeasurementAssignment>) {
    setAssignmentDrafts((current) => current.map((assignment, itemIndex) =>
      itemIndex === index ? { ...assignment, ...change } : assignment,
    ));
  }

  function toggleAssignmentChannel(index: number, channelId: string, checked: boolean) {
    setAssignmentDrafts((current) => current.map((assignment, itemIndex) => {
      if (itemIndex !== index) return assignment;
      const selected = new Set(assignment.channelIds);
      if (checked) selected.add(channelId);
      else selected.delete(channelId);
      return { ...assignment, channelIds: [...selected] };
    }));
  }

  function assignmentDeviceDetails(assignment: MeasurementAssignment) {
    const device = tree.meterDevices?.find((item) => item.id === assignment.meterId);
    const installedBoard = device
      ? tree.electricalAssets.find((item) => item.id === device.installedOnBoardId)
      : undefined;
    const channelOrdinals = device
      ? assignment.channelIds
        .map((id) => device.channels.find((channel) => channel.id === id)?.ordinal)
        .filter((ordinal): ordinal is number => typeof ordinal === 'number')
      : [];
    return {
      device,
      installedBoard,
      channelOrdinals,
      href: device && installedBoard
        ? `/installhub/installations/${encodeURIComponent(installationId)}/zones/${encodeURIComponent(installedBoard.zoneId)}/boards/${encodeURIComponent(installedBoard.id)}/meters/${encodeURIComponent(device.id)}#meter-assignments`
        : null,
    };
  }

  function chooseSiteAssetTarget(assignmentIndex: number, siteAssetId: string) {
    if (!siteAssetId) {
      updateAssignment(assignmentIndex, { target: { kind: 'SITE_ASSET', siteAssetId: '' }, status: 'CONFIRMED' });
      return;
    }
    const existingAssignment = assignmentForAsset(tree, siteAssetId);
    if (
      existingAssignment
      && existingAssignment.meterId !== currentDraft.id
      && approvedCrossMeterAssignments.get(existingAssignment.id) !== assignmentApprovalSignature(existingAssignment)
    ) {
      setPendingAssetRemap({
        assignmentId: assignmentDrafts[assignmentIndex].id,
        siteAssetId,
        existingAssignment,
      });
      return;
    }
    updateAssignment(assignmentIndex, { target: { kind: 'SITE_ASSET', siteAssetId }, status: 'CONFIRMED' });
  }

  function approveAssetRemap() {
    if (!pendingAssetRemap) return;
    setApprovedCrossMeterAssignments((current) => {
      const next = new Map(current);
      next.set(
        pendingAssetRemap.existingAssignment.id,
        assignmentApprovalSignature(pendingAssetRemap.existingAssignment),
      );
      return next;
    });
    setAssignmentDrafts((current) => current.map((assignment) => (
      assignment.id === pendingAssetRemap.assignmentId
        ? { ...assignment, target: { kind: 'SITE_ASSET', siteAssetId: pendingAssetRemap.siteAssetId }, status: 'CONFIRMED' }
        : assignment
    )));
    setPendingAssetRemap(null);
  }

  function approveDraftChannelMove() {
    if (!pendingDraftChannelMove) return;
    setAssignmentDrafts((current) => current
      .filter((assignment) => assignment.id !== pendingDraftChannelMove.fromAssignmentId)
      .map((assignment) => assignment.id === pendingDraftChannelMove.toAssignmentId
        ? { ...assignment, channelIds: [...new Set([...assignment.channelIds, pendingDraftChannelMove.channelId])] }
        : assignment));
    setPendingDraftChannelMove(null);
  }

  function chooseAssignmentTarget(index: number, kind: MeasurementAssignment['target']['kind']) {
    const target: MeasurementAssignment['target'] = kind === 'BOARD'
      ? { kind: 'BOARD', boardId: assignmentPurpose(assignmentDrafts[index]) === 'MAIN_SUPPLY' ? boardId : '' }
      : kind === 'SITE_ASSET'
        ? { kind: 'SITE_ASSET', siteAssetId: '' }
        : kind === 'GRID_BOUNDARY'
          ? { kind: 'GRID_BOUNDARY', gridSupplyId: reachableGridSupplies[0]?.id || '' }
          : { kind: 'TBC' };
    updateAssignment(index, { target, status: kind === 'TBC' ? 'TBC' : 'CONFIRMED' });
  }

  function assignmentPurpose(assignment: MeasurementAssignment): 'MAIN_SUPPLY' | 'SUB_CIRCUIT' | undefined {
    const purpose = (currentDraft.wwChannels || []).find((channel, index) =>
      assignment.channelIds.includes(channel.id || meterChannelId(currentDraft.id, index)),
    )?.purpose;
    return purpose === 'MAIN_SUPPLY' || purpose === 'SUB_CIRCUIT' ? purpose : undefined;
  }

  const pendingRemapTarget = pendingAssetRemap
    ? draftMeasurementTargetDetails({ kind: 'SITE_ASSET', siteAssetId: pendingAssetRemap.siteAssetId })
    : null;
  const pendingRemapDevice = pendingAssetRemap
    ? assignmentDeviceDetails(pendingAssetRemap.existingAssignment)
    : null;
  const pendingMoveFrom = pendingDraftChannelMove
    ? assignmentDrafts.find((assignment) => assignment.id === pendingDraftChannelMove.fromAssignmentId)
    : null;
  const pendingMoveTo = pendingDraftChannelMove
    ? assignmentDrafts.find((assignment) => assignment.id === pendingDraftChannelMove.toAssignmentId)
    : null;
  const pendingMoveFromTarget = pendingMoveFrom
    ? draftMeasurementTargetDetails(pendingMoveFrom.target)
    : null;
  const pendingMoveToTarget = pendingMoveTo
    ? draftMeasurementTargetDetails(pendingMoveTo.target)
    : null;

  const photoFields: Array<{
    slot: 'deviceInstalled' | 'switchboardOverview' | 'labeling';
    label: string;
  }> = [
    { slot: 'deviceInstalled', label: 'Installed device' },
    { slot: 'switchboardOverview', label: 'Switchboard overview' },
    { slot: 'labeling', label: 'Device and channel labeling' },
  ];
  const expectedChannelCount = currentDraft.deviceType === 'A3RM'
    ? 3
    : currentDraft.deviceType === 'A6M'
      ? 6
      : null;
  const channelLayoutInvalid = (
    expectedChannelCount !== null
    && (currentDraft.wwChannels?.length || 0) !== expectedChannelCount
  ) || (currentDraft.wwChannels || []).some(
    (channel, index) => channel.ordinal !== index + 1,
  );

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: zone?.zoneName ?? 'Zone', href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: board.assetName, href: `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}` },
        { label: mode === 'new' ? 'Add meter' : visibleDeviceName },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'Add a meter' : visibleDeviceName}
        subtitle={mode === 'new'
          ? 'Choose the device family below. The form adapts to collect only the identity, channel, installation, commissioning, and evidence details that apply.'
          : draft.deviceType === 'Other'
            ? 'Device identity, classification, coverage, channels, assignments, and evidence.'
            : 'Device identity, safety, switchboard, channels, verification, commissioning, and evidence.'}
        actions={saved ? (
          <>
            {commissionedForm ? (
              <LinkButton href={`/installhub/installations/${installationId}/forms/${commissionedForm.id}`} variant="secondary">
                <Icon name="clipboard" size={17} />View record / amend
              </LinkButton>
            ) : null}
            {draft.deviceType === 'A3RM' || draft.deviceType === 'A6M' ? (
              <Button disabled={busy || replacementBusy || writer.hasPendingTree} onClick={() => void startReplacement()}>
                <Icon name="tool" size={17} />
                {replacementBusy ? 'Opening replacement…' : 'Replace device / Comms'}
              </Button>
            ) : null}
            <Button variant="danger" disabled={busy || writer.hasPendingTree} onClick={() => setConfirmDelete(true)}>Remove</Button>
          </>
        ) : undefined}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-sub)]">
          Installed on: <strong className="text-[var(--text)]">{board.assetName} · {boardTypeLabel(board)}</strong>
        </p>
        <SaveStateNotice
          state={writer.writeState}
          onRetry={() => void retryTreeWrite()}
          onDiscard={() => void discardTreeWrite()}
        />
      </div>
      {saved ? (
        <RecordNavigation
          title="Meter navigation"
          description="Open the physical location, installed switchboard, exact channels, assignments, commissioning, or evidence without retracing the full form."
          items={[
            {
              href: `/installhub/installations/${installationId}/zones/${zoneId}`,
              icon: 'map-pin',
              label: 'Physical zone',
              description: zone?.zoneName || 'Zone',
            },
            {
              href: `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}`,
              icon: 'zap',
              label: 'Installed switchboard',
              description: `${board.assetName} · ${boardTypeLabel(board)}`,
            },
            {
              href: '#meter-device',
              icon: 'gauge',
              label: 'Device details',
              description: draft.deviceId || 'Identity and serial details',
            },
            {
              href: '#meter-channels',
              icon: 'plug',
              label: 'Channels',
              description: 'Purpose, load, phase, and sensor data',
              meta: draft.wwChannels?.length ?? 0,
            },
            {
              href: '#meter-assignments',
              icon: 'arrow-right',
              label: 'Channel assignments',
              description: 'Exact measurement targets',
              meta: assignmentDrafts.length,
            },
            ...(showWattwatchersSections ? [{
              href: '#meter-verification',
              icon: 'check' as const,
              label: 'Verification',
              description: 'Commissioning checks and evidence',
            }] : []),
          ]}
        />
      ) : null}
      {assetReturn ? (
        <div className="mb-5">
          <InlineNotice>
            This device is being added for an in-progress site asset mapping. Save the device and you will return to the preserved asset draft to choose its exact channels. Other active channels can be mapped later and will remain visible in reconciliation until resolved.
          </InlineNotice>
        </div>
      ) : null}
      <TreeDraftNavigationGuard active={!busy && !uploading && (hasLocalChanges || writer.hasPendingTree)} onDiscard={writer.discard} />
      <ErrorSummary errors={errors} />
      {commissionedForm ? (
        <div className="mb-5">
          <InlineNotice>
            Device identity, commissioning answers, and channel topology are locked by a completed Installation Form (WW). Use “View record / amend” for authoritative corrections. The display label, notes, and operational relationship mappings remain editable here.
          </InlineNotice>
        </div>
      ) : null}

      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy || writer.hasPendingTree} className="space-y-5">
        <Card id="meter-device" tabIndex={-1} className="scroll-mt-4">
          <h2 className="font-extrabold text-[var(--text)]">Device identity</h2>
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="meter-family">Device family</FieldLabel>
              <Select id="meter-family" value={draft.deviceFamily || 'WATTWATCHERS'} aria-describedby="meter-family-hint" disabled={Boolean(commissionedForm) || fixedOtherWorkflow} onChange={(event) => chooseDeviceFamily(event.target.value as 'WATTWATCHERS' | 'OTHER')}>
                <option value="WATTWATCHERS">Wattwatchers</option>
                <option value="OTHER">Other manufacturer</option>
              </Select>
              <FieldHint id="meter-family-hint">
                {draft.deviceFamily === 'OTHER'
                  ? 'Showing custom manufacturer, model, channel, assignment, and evidence fields.'
                  : 'Showing Wattwatchers identity, safety, switchboard, channel, verification, commissioning, and evidence fields.'}
              </FieldHint>
            </div>
            <div>
              <FieldLabel htmlFor="meter-model">Device model</FieldLabel>
              <Select
                id="meter-model"
                value={draft.deviceType}
                disabled={Boolean(commissionedForm) || fixedOtherWorkflow}
                onChange={(event) => chooseDeviceType(event.target.value as Meter['deviceType'])}
              >
                {draft.deviceFamily !== 'OTHER' ? <option>A3RM</option> : null}
                {draft.deviceFamily !== 'OTHER' ? <option>A6M</option> : null}
                {draft.deviceFamily === 'OTHER' ? <option>Other</option> : null}
              </Select>
              {fixedOtherWorkflow ? <FieldHint>This saved other-manufacturer meter keeps its existing device family.</FieldHint> : null}
            </div>
            {draft.deviceFamily === 'OTHER' ? (
              <div>
                <FieldLabel htmlFor="meter-custom-manufacturer">Manufacturer</FieldLabel>
                <Input id="meter-custom-manufacturer" value={draft.customManufacturerName ?? ''} disabled={Boolean(commissionedForm)} aria-invalid={errors.some((item) => item.id === 'meter-custom-manufacturer')} onChange={(event) => setMeterIdentityDetail('customManufacturerName', event.target.value)} />
                <FieldError message={errors.find((item) => item.id === 'meter-custom-manufacturer')?.message} />
              </div>
            ) : null}
            {draft.deviceType === 'Other' ? (
              <div>
                <FieldLabel htmlFor="meter-custom-model">Custom model</FieldLabel>
                <Input id="meter-custom-model" value={draft.customModelName ?? ''} disabled={Boolean(commissionedForm)} aria-invalid={errors.some((item) => item.id === 'meter-custom-model')} onChange={(event) => setMeterIdentityDetail('customModelName', event.target.value)} />
                <FieldError message={errors.find((item) => item.id === 'meter-custom-model')?.message} />
              </div>
            ) : null}
            <div>
              <FieldLabel htmlFor="meter-name">Device name</FieldLabel>
              <Input
                id="meter-name"
                value={visibleDeviceName}
                maxLength={ENTITY_NAME_MAX_LENGTH}
                aria-invalid={errors.some((item) => item.id === 'meter-name')}
                onChange={(event) => setDraft((current) => current ? {
                  ...current,
                  customName: event.target.value,
                } : current)}
              />
              <FieldHint>Defaults from the device model, remains editable, and accepts up to {ENTITY_NAME_MAX_LENGTH} characters.</FieldHint>
              <FieldError message={errors.find((item) => item.id === 'meter-name')?.message} />
            </div>
            <div>
              <FieldLabel htmlFor="meter-display-code">Generated asset ID</FieldLabel>
              <Input id="meter-display-code" readOnly value={previewDisplayName.value} />
              <FieldHint>
                {previewDisplayName.provisional !== true
                  ? 'This confirmed identifier is fixed.'
                  : 'Built from installation code, zone code, shared sequence, and device name. The server confirms it on save.'}
              </FieldHint>
            </div>
            <div>
              <FieldLabel>Device ID / serial</FieldLabel>
              <div id="meter-serial" tabIndex={-1}>
                <ScannerInput value={draft.deviceId} onChange={(value) => set('deviceId', value)} modes={['barcode', 'qr']} disabled={Boolean(commissionedForm)} />
              </div>
              <FieldError message={errors.find((item) => item.id === 'meter-serial')?.message} />
            </div>
            <div>
              <FieldLabel htmlFor="meter-device-number">Site / asset tag (optional)</FieldLabel>
              <Input
                id="meter-device-number"
                value={draft.deviceNumber ?? ''}
                disabled={Boolean(commissionedForm)}
                placeholder="e.g. D001 or M-02"
                onChange={(event) => set('deviceNumber', event.target.value)}
              />
              <FieldHint>This is a site-assigned operational tag, not the manufacturer Device ID / serial.</FieldHint>
            </div>
            <div>
              <FieldLabel htmlFor="meter-classification">Classification</FieldLabel>
              <Select id="meter-classification" value={draft.classification ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => set('classification', event.target.value)}>
                <option value="">Select classification</option>
                {withLegacyOption(METER_CLASSIFICATIONS, draft.classification ?? undefined).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="meter-coverage">Coverage</FieldLabel>
              <Select id="meter-coverage" value={draft.coverage ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => set('coverage', event.target.value)}>
                <option value="">Select coverage</option>
                {withLegacyOption(METER_COVERAGE_OPTIONS, draft.coverage ?? undefined).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>
          </div>
          <FieldLabel htmlFor="meter-notes">Operational notes</FieldLabel>
          <Textarea id="meter-notes" value={draft.notes ?? ''} onChange={(event) => set('notes', event.target.value)} />
        </Card>

        {showWattwatchersSections ? (
          <>
            <Card>
              <h2 className="font-extrabold text-[var(--text)]">Pre-start safety</h2>
              <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
                {prestartQuestions.map(([key, label]) => (
                  <Checkbox key={key} label={label} checked={Boolean(draft.wwPrestart?.[key])} disabled={Boolean(commissionedForm)} onChange={(checked) => setPrestart(key, checked)} />
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="font-extrabold text-[var(--text)]">Switchboard details</h2>
              <div className="grid gap-x-4 lg:grid-cols-2">
                <div>
                  <FieldLabel>Switchboard name</FieldLabel>
                  <Input value={draft.wwSwitchboard?.name ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => setSwitchboard('name', event.target.value)} />
                </div>
                <div>
                  <FieldLabel>Location</FieldLabel>
                  <Input value={draft.wwSwitchboard?.location ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => setSwitchboard('location', event.target.value)} />
                </div>
                <div>
                  <FieldLabel>Auditor serial (optional)</FieldLabel>
                  <ScannerInput
                    value={draft.wwSwitchboard?.deviceSerial ?? ''}
                    onChange={(value) => setSwitchboard('deviceSerial', value)}
                    modes={['barcode', 'qr']}
                    disabled={Boolean(commissionedForm)}
                  />
                </div>
                <div>
                  <FieldLabel>Firmware</FieldLabel>
                  <Input value={draft.wwSwitchboard?.firmware ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => setSwitchboard('firmware', event.target.value)} />
                </div>
                <div>
                  <FieldLabel>Antenna</FieldLabel>
                  <Select value={draft.wwSwitchboard?.antennaType ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => setSwitchboard('antennaType', event.target.value)}>
                    <option value="">Select an option</option>
                    {withLegacyOption(ANTENNA_TYPES, draft.wwSwitchboard?.antennaType).map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <FieldLabel>Signal</FieldLabel>
                  <Select value={draft.wwSwitchboard?.signalStrength ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => setSwitchboard('signalStrength', event.target.value)}>
                    <option value="">Select an option</option>
                    {withLegacyOption(SIGNAL_STRENGTHS, draft.wwSwitchboard?.signalStrength).map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <FieldLabel>Notes</FieldLabel>
              <Textarea value={draft.wwSwitchboard?.notes ?? ''} onChange={(event) => setSwitchboard('notes', event.target.value)} />
            </Card>
          </>
        ) : null}

        <Card>
          <div id="meter-channels" tabIndex={-1} className="scroll-mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Channels</h2>
              <p className="mt-1 text-xs text-[var(--text-sub)]">Three channels for A3RM, six for A6M, or one or more explicit custom channels.</p>
            </div>
            {draft.deviceType === 'Other' && !commissionedForm ? (
              <Button variant="secondary" onClick={addCustomChannel}><Icon name="plus" size={16} />Add channel</Button>
            ) : null}
          </div>
          <div id="meter-channel-layout" tabIndex={-1} className="scroll-mt-4">
            {channelLayoutInvalid ? (
              <div className="mt-3">
                <InlineNotice tone="warning">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      {expectedChannelCount === null
                        ? 'Channel ordinals must be unique positive numbers in display order.'
                        : `${currentDraft.deviceType} normally uses ${expectedChannelCount} channels numbered 1 through ${expectedChannelCount}.`}
                    </span>
                    {commissionedForm ? (
                      <LinkButton
                        href={`/installhub/installations/${installationId}/forms/${commissionedForm.id}#form-completed-actions`}
                        variant="secondary"
                      >
                        Open amendment action
                      </LinkButton>
                    ) : (
                      <Button variant="secondary" onClick={() => chooseDeviceType(currentDraft.deviceType)}>
                        Restore channel layout
                      </Button>
                    )}
                  </div>
                </InlineNotice>
              </div>
            ) : null}
          </div>
          <FieldError message={errors.find((item) => item.id === 'meter-channels')?.message} />
          <div className="mt-4 space-y-3">
            {(draft.wwChannels ?? []).map((channel, index) => (
              <div key={index} id={`meter-channel-${index + 1}`} tabIndex={-1} className="scroll-mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-[var(--text)]">Channel {channel.ordinal || index + 1}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {channel.purpose === 'SUB_CIRCUIT' ? (() => {
                      const channelId = channel.id || meterChannelId(draft.id, index);
                      const existingAssignment = assignmentDrafts.find((candidate) => candidate.channelIds.includes(channelId));
                      if (existingAssignment && existingAssignment.target.kind !== 'TBC') return null;
                      return (
                        <Button
                          variant="secondary"
                          onClick={() => openAssetQuickAdd({
                            channelId,
                            assignmentId: existingAssignment?.id,
                          })}
                        >
                          <Icon name="plus" size={15} />Add site asset
                        </Button>
                      );
                    })() : null}
                    {draft.deviceType === 'Other' && !commissionedForm ? (
                      <Button variant="ghost" className="text-[var(--red)]" onClick={() => removeCustomChannel(index)}><Icon name="trash" size={16} />Remove</Button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-x-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <FieldLabel htmlFor={`meter-channel-${index + 1}-purpose`}>Purpose</FieldLabel>
                    <Select
                      id={`meter-channel-${index + 1}-purpose`}
                      value={channel.purpose || 'SPARE'}
                      disabled={Boolean(commissionedForm)}
                      onChange={(event) => {
                        updateChannel(index, { purpose: event.target.value });
                      }}
                    >
                      {CHANNEL_PURPOSE_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>{option.label}</option>
                      ))}
                    </Select>
                  </div>
                  {channel.purpose !== 'SPARE' ? (
                    <>
                      <div>
                        <FieldLabel htmlFor={`meter-channel-${index + 1}-load-type`}>Load type</FieldLabel>
                        <Select
                          id={`meter-channel-${index + 1}-load-type`}
                          value={channel.loadType || 'Not Used'}
                          disabled={Boolean(commissionedForm)}
                          onChange={(event) => {
                            updateChannel(index, {
                              loadType: event.target.value,
                              customLoadTypeName: event.target.value === 'Other' ? channel.customLoadTypeName : undefined,
                            });
                          }}
                        >
                          {withLegacyOption(
                            LOAD_TYPES,
                            channel.loadType,
                          ).map((option) => (
                            <option key={option}>{option}</option>
                          ))}
                        </Select>
                      </div>
                      {channel.loadType === 'Other' ? (
                        <div>
                          <FieldLabel htmlFor={`meter-channel-${index + 1}-custom`}>Custom load type</FieldLabel>
                          <Input
                            id={`meter-channel-${index + 1}-custom`}
                            value={channel.customLoadTypeName ?? ''}
                            disabled={Boolean(commissionedForm)}
                            aria-invalid={errors.some((item) => item.id === `meter-channel-${index + 1}-custom`)}
                            onChange={(event) => updateChannel(index, { customLoadTypeName: event.target.value })}
                          />
                          <FieldError message={errors.find((item) => item.id === `meter-channel-${index + 1}-custom`)?.message} />
                        </div>
                      ) : null}
                      {draft.deviceType === 'A6M' ? (
                        <div>
                          <FieldLabel htmlFor={`meter-channel-${index + 1}-sensor`}>CT rating</FieldLabel>
                          <Select
                            id={`meter-channel-${index + 1}-sensor`}
                            value={channel.ctRatio ?? ''}
                            disabled={Boolean(commissionedForm)}
                            onChange={(event) => {
                              updateChannel(index, { ctRatio: event.target.value });
                            }}
                          >
                            <option value="">Select an option</option>
                            {withLegacyOption(
                              CT_RATINGS,
                              channel.ctRatio,
                            ).map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                      {draft.deviceType === 'A3RM' ? (
                        <div>
                          <FieldLabel htmlFor={`meter-channel-${index + 1}-sensor`}>Rogowski coil</FieldLabel>
                          <Select
                            id={`meter-channel-${index + 1}-sensor`}
                            value={channel.rogowskiSize ?? ''}
                            disabled={Boolean(commissionedForm)}
                            onChange={(event) => {
                              updateChannel(index, { rogowskiSize: event.target.value });
                            }}
                          >
                            <option value="">Select an option</option>
                            {withLegacyOption(
                              ROGOWSKI_SIZES,
                              channel.rogowskiSize,
                            ).map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                      <div>
                        <FieldLabel htmlFor={`meter-channel-${index + 1}-description`}>Description</FieldLabel>
                        <Input
                          id={`meter-channel-${index + 1}-description`}
                          value={channel.description ?? ''}
                          disabled={Boolean(commissionedForm)}
                          onChange={(event) => {
                            updateChannel(index, { description: event.target.value });
                          }}
                        />
                      </div>
                      {draft.deviceType === 'Other' ? (
                        <>
                          <div>
                            <FieldLabel htmlFor={`meter-channel-${index + 1}-phase-label`}>Phase label</FieldLabel>
                            <Input
                              id={`meter-channel-${index + 1}-phase-label`}
                              value={channel.phaseLabel ?? ''}
                              disabled={Boolean(commissionedForm)}
                              placeholder="e.g. L1, Red, Neutral"
                              onChange={(event) => updateChannel(index, { phaseLabel: event.target.value })}
                            />
                          </div>
                          <div>
                            <FieldLabel htmlFor={`meter-channel-${index + 1}-sensor`}>Sensor rating / metadata</FieldLabel>
                            <Input
                              id={`meter-channel-${index + 1}-sensor`}
                              value={channel.rogowskiSize || channel.ctRatio || ''}
                              disabled={Boolean(commissionedForm)}
                              placeholder="Observed sensor rating"
                              onChange={(event) => updateChannel(index, { rogowskiSize: event.target.value, ctRatio: undefined })}
                            />
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {draft.deviceType === 'Other' ? (
                  <div id={`meter-channel-${index + 1}-capabilities`} tabIndex={-1} className="mt-4 border-t border-[var(--border)] pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-[var(--text)]">Channel capabilities</h4>
                        <p className="mt-1 text-xs text-[var(--text-sub)]">Record arbitrary manufacturer capability keys without assuming a standard meter layout.</p>
                      </div>
                      {!commissionedForm ? <Button variant="ghost" onClick={() => addCapability(index)}><Icon name="plus" size={15} />Add capability</Button> : null}
                    </div>
                    <div className="mt-2 space-y-2">
                      {Object.entries(channel.capabilities || {}).map(([key, value]) => (
                        <div key={key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                          <Input
                            aria-label={`Channel ${index + 1} capability name`}
                            defaultValue={key}
                            disabled={Boolean(commissionedForm)}
                            onBlur={(event) => {
                              if (!renameCapability(index, key, event.target.value)) {
                                event.currentTarget.value = key;
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                            }}
                          />
                          <Input
                            aria-label={`Channel ${index + 1} capability value`}
                            value={typeof value === 'string' ? value : JSON.stringify(value)}
                            disabled={Boolean(commissionedForm)}
                            onChange={(event) => setChannelCapabilities(index, {
                              ...(channel.capabilities || {}),
                              [key]: event.target.value,
                            })}
                          />
                          {!commissionedForm ? (
                            <Button
                              variant="ghost"
                              className="text-[var(--red)]"
                              aria-label={`Remove ${key} capability`}
                              onClick={() => {
                                const capabilities = { ...(channel.capabilities || {}) };
                                delete capabilities[key];
                                setChannelCapabilities(index, capabilities);
                              }}
                            >
                              <Icon name="trash" size={16} />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <FieldError message={errors.find((item) => item.id === `meter-channel-${index + 1}-capabilities`)?.message} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          </div>
        </Card>

        <Card>
          <div id="meter-assignments" tabIndex={-1} className="scroll-mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">What these channels measure</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-sub)]">
                Group channels that measure the same circuit, choose the observed phase grouping, select the switchboard, site asset, or incoming connection being measured, and record whether energy is consumed, generated, or can flow both ways.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => openAssetQuickAdd()}>
                <Icon name="plus" size={16} />Add site asset
              </Button>
              <Button
                variant="secondary"
                disabled={!(draft.wwChannels || []).some((channel) => channel.purpose && channel.purpose !== 'SPARE')}
                onClick={addAssignment}
              >
                <Icon name="plus" size={16} />Map channels
              </Button>
            </div>
          </div>
          <FieldError message={errors.find((item) => item.id === 'meter-assignments')?.message} />
          {!(draft.wwChannels || []).some((channel) => channel.purpose && channel.purpose !== 'SPARE') ? (
            <p className="mt-3 text-sm text-[var(--text-sub)]">Mark a channel as “Main board supply” or “Sub-circuit / asset” to create an assignment.</p>
          ) : null}
          <div className="mt-4 space-y-4">
            {assignmentDrafts.map((assignment, assignmentIndex) => {
              const historicalOffBoard = isHistoricalOffBoardAssignment(assignment);
              return (
              <div
                key={assignment.id}
                id={`meter-assignment-${assignmentIndex + 1}`}
                tabIndex={-1}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-bold text-[var(--text)]">Measurement group {assignmentIndex + 1}</h3>
                  {historicalOffBoard ? (
                    <Button
                      variant="secondary"
                      onClick={() => updateAssignment(assignmentIndex, {
                        target: { kind: 'TBC' },
                        status: 'TBC',
                      })}
                    >
                      Convert target to TBC
                    </Button>
                  ) : (
                    <Button variant="ghost" className="text-[var(--red)]" onClick={() => setAssignmentDrafts((current) => current.filter((_, index) => index !== assignmentIndex))}>
                      <Icon name="trash" size={16} />Remove
                    </Button>
                  )}
                </div>
                {historicalOffBoard ? (
                  <InlineNotice tone="warning">
                    This historical asset is not directly supplied by this meter’s installed switchboard. The mapping is preserved read-only; convert its target to TBC before choosing a replacement.
                  </InlineNotice>
                ) : null}
                <div className="grid gap-x-4 lg:grid-cols-3">
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-phase`}>Phase grouping</FieldLabel>
                    <Select
                      id={`meter-assignment-${assignmentIndex + 1}-phase`}
                      value={assignment.phaseMode}
                      disabled={historicalOffBoard}
                      onChange={(event) => updateAssignment(assignmentIndex, {
                        phaseMode: event.target.value as MeasurementAssignment['phaseMode'],
                        channelIds: [],
                      })}
                    >
                      <option value="SINGLE_PHASE">Single phase — select 1 channel</option>
                      <option value="THREE_PHASE">Three phase — select 3 channels</option>
                      <option value="OTHER">Other observed grouping</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-kind`}>Measured item</FieldLabel>
                    <Select
                      id={`meter-assignment-${assignmentIndex + 1}-kind`}
                      value={assignment.target.kind}
                      disabled={historicalOffBoard}
                      onChange={(event) => chooseAssignmentTarget(assignmentIndex, event.target.value as 'BOARD' | 'GRID_BOUNDARY' | 'SITE_ASSET' | 'TBC')}
                    >
                      <option value="TBC">To be confirmed</option>
                      <option value="BOARD">Switchboard</option>
                      <option value="GRID_BOUNDARY" disabled={assignmentPurpose(assignment) === 'SUB_CIRCUIT'}>Incoming grid connection</option>
                      <option value="SITE_ASSET" disabled={assignmentPurpose(assignment) === 'MAIN_SUPPLY'}>Site asset</option>
                    </Select>
                    {assignment.target.kind === 'TBC' && assignmentPurpose(assignment) === 'SUB_CIRCUIT' ? (
                      <Button variant="ghost" onClick={() => openAssetQuickAdd({ assignmentId: assignment.id })}>
                        <Icon name="plus" size={15} />Create a new site asset for this group
                      </Button>
                    ) : null}
                  </div>
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-direction`}>Energy flow</FieldLabel>
                    <Select
                      id={`meter-assignment-${assignmentIndex + 1}-direction`}
                      value={assignment.direction}
                      disabled={historicalOffBoard}
                      onChange={(event) => updateAssignment(assignmentIndex, { direction: event.target.value as MeasurementAssignment['direction'] })}
                    >
                      <option value="CONSUMPTION">Consumption</option>
                      <option value="GENERATION">Generation</option>
                      <option value="BIDIRECTIONAL">Bidirectional</option>
                    </Select>
                  </div>
                </div>

                {assignment.target.kind === 'BOARD' ? (
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-target`}>Measured switchboard</FieldLabel>
                    <SearchableSelect
                      id={`meter-assignment-${assignmentIndex + 1}-target`}
                      value={assignment.target.boardId}
                      disabled={historicalOffBoard}
                      options={assignmentBoardCandidates(assignment).map((item) => {
                        const itemZone = tree.zones.find((candidate) => candidate.id === item.zoneId);
                        return {
                          value: item.id,
                          label: `${item.assetName} · ${boardTypeLabel(item)} · ${itemZone?.zoneName || 'Unknown zone'}`,
                          keywords: `${item.displayCodeMeta?.value || item.displayCode} ${item.id}`,
                        };
                      })}
                      placeholder="Search code, name, type, or zone"
                      emptyMessage="No eligible switchboards match this search."
                      onChange={(value) => updateAssignment(assignmentIndex, { target: { kind: 'BOARD', boardId: value }, status: 'CONFIRMED' })}
                    />
                    <FieldHint>{assignmentPurpose(assignment) === 'MAIN_SUPPLY' ? 'A confirmed main-supply board total must target this device’s installed switchboard.' : assignmentPurpose(assignment) === 'SUB_CIRCUIT' ? 'Sub-circuit channels may target only a downstream switchboard.' : 'Choose channels to constrain the eligible switchboards. Search and choose in one field; up to 100 matches are shown.'}</FieldHint>
                  </div>
                ) : null}
                {assignment.target.kind === 'SITE_ASSET' ? (
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-target`}>Measured site asset</FieldLabel>
                    <SearchableSelect
                      id={`meter-assignment-${assignmentIndex + 1}-target`}
                      value={assignment.target.siteAssetId}
                      disabled={historicalOffBoard}
                      options={assignmentAssetCandidates(assignment).map((item) => {
                        const occupied = assignmentForAsset(tree, item.id);
                        const occupiedDevice = occupied ? assignmentDeviceDetails(occupied) : null;
                        const occupiedLabel = occupied && occupied.meterId !== currentDraft.id
                          ? ` · currently ${occupiedDevice?.device ? humanDeviceName(occupiedDevice.device) : occupied.meterId}, channel${occupiedDevice?.channelOrdinals.length === 1 ? '' : 's'} ${occupiedDevice?.channelOrdinals.join(', ') || occupied.channelIds.join(', ')}`
                          : '';
                        const itemZone = tree.zones.find((candidate) => candidate.id === item.zoneId);
                        return {
                          value: item.id,
                          label: `${item.assetName} · ${siteAssetTypeLabel(item)} · ${itemZone?.zoneName || 'Unknown zone'}${occupiedLabel}`,
                          keywords: `${item.displayCodeMeta?.value || item.displayCode || ''} ${item.id}`,
                        };
                      })}
                      placeholder="Search code, name, type, or zone"
                      emptyMessage="No eligible site assets match this search."
                      onChange={(value) => chooseSiteAssetTarget(assignmentIndex, value)}
                    />
                    <FieldHint>Only assets directly supplied by this meter’s installed switchboard are eligible. Choosing an occupied asset shows the exact device and asks you to approve the reassignment. Search and choose in one field; up to 100 matches are shown.</FieldHint>
                    {(() => {
                      if (!assignment.target.siteAssetId) return null;
                      const occupied = assignmentForAsset(tree, assignment.target.siteAssetId);
                      if (!occupied || occupied.meterId === currentDraft.id) return null;
                      const occupiedDevice = assignmentDeviceDetails(occupied);
                      const targetDetails = draftMeasurementTargetDetails(occupied.target);
                      const selectedSiteAssetId = assignment.target.siteAssetId;
                      const approvalIsCurrent = approvedCrossMeterAssignments.get(occupied.id)
                        === assignmentApprovalSignature(occupied);
                      return (
                        <InlineNotice>
                          <span className="font-semibold">{approvalIsCurrent ? 'Reassignment approved:' : 'Reassignment approval required:'}</span> {targetDetails.label} is currently attached through {occupiedDevice.device ? humanDeviceName(occupiedDevice.device) : occupied.meterId}
                          {occupiedDevice.installedBoard ? ` on ${occupiedDevice.installedBoard.assetName}` : ''}, channel{occupiedDevice.channelOrdinals.length === 1 ? '' : 's'} {occupiedDevice.channelOrdinals.join(', ') || occupied.channelIds.join(', ')}. Saving moves the asset here and releases the old device’s full group.
                          {occupiedDevice.href ? <> <Link className="font-semibold underline" href={occupiedDevice.href}>Open current device mapping</Link>.</> : null}
                          {!approvalIsCurrent ? (
                            <span className="mt-3 block">
                              <Button
                                variant="secondary"
                                onClick={() => chooseSiteAssetTarget(assignmentIndex, selectedSiteAssetId)}
                              >
                                Review and approve current mapping
                              </Button>
                            </span>
                          ) : null}
                        </InlineNotice>
                      );
                    })()}
                  </div>
                ) : null}
                {assignment.target.kind === 'GRID_BOUNDARY' ? (
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-target`}>Measured Grid boundary</FieldLabel>
                    <Select
                      id={`meter-assignment-${assignmentIndex + 1}-target`}
                      value={assignment.target.gridSupplyId}
                      disabled={historicalOffBoard}
                      onChange={(event) => updateAssignment(assignmentIndex, { target: { kind: 'GRID_BOUNDARY', gridSupplyId: event.target.value }, status: 'CONFIRMED' })}
                    >
                      {reachableGridSupplies.map((supply) => (
                        <option key={supply.id} value={supply.id}>{supply.name}{supply.nmi ? ` · NMI ${supply.nmi}` : ''}</option>
                      ))}
                    </Select>
                    <FieldHint>{reachableGridSupplies.length ? 'Only Grid supplies on this switchboard’s confirmed upstream path are available.' : 'No confirmed upstream Grid boundary is reachable. Reconcile the switchboard supply first.'}</FieldHint>
                  </div>
                ) : null}
                {assignment.target.kind === 'TBC' ? (
                  <InlineNotice>This target will appear in reconciliation and block completion.</InlineNotice>
                ) : null}

                <fieldset id={`meter-assignment-${assignmentIndex + 1}-channels`} className="mt-4" tabIndex={-1}>
                  <legend className="text-sm font-bold text-[var(--text)]">Measured channels in this group</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(draft.wwChannels || []).map((channel, channelIndex) => {
                      if (!channel.purpose || channel.purpose === 'SPARE') return null;
                      const channelId = channel.id || meterChannelId(draft.id, channelIndex);
                      const usedByAnotherIndex = assignmentDrafts.findIndex(
                        (candidate, index) => index !== assignmentIndex && candidate.channelIds.includes(channelId),
                      );
                      const usedByAnother = usedByAnotherIndex >= 0;
                      const owningAssignment = usedByAnother ? assignmentDrafts[usedByAnotherIndex] : null;
                      const owningTarget = owningAssignment ? draftMeasurementTargetDetails(owningAssignment.target) : null;
                      const mixedPurpose = Boolean(assignmentPurpose(assignment) && assignmentPurpose(assignment) !== channel.purpose);
                      return (
                        <div key={channelId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
                          <Checkbox
                            label={`Channel ${channelIndex + 1} — ${channel.description || channel.loadType || 'Sub-circuit'}`}
                            checked={assignment.channelIds.includes(channelId)}
                            disabled={historicalOffBoard || usedByAnother || mixedPurpose}
                            onChange={(checked) => toggleAssignmentChannel(assignmentIndex, channelId, checked)}
                          />
                          {usedByAnother && owningAssignment && owningTarget ? (
                            <div className="space-y-1 pb-2 pl-8 text-xs leading-5 text-[var(--amber)]">
                              <p>Used by measurement group {usedByAnotherIndex + 1}: {owningTarget.label} ({owningAssignment.phaseMode.replaceAll('_', ' ').toLowerCase()}).</p>
                              <Button
                                variant="secondary"
                                onClick={() => setPendingDraftChannelMove({
                                  fromAssignmentId: owningAssignment.id,
                                  toAssignmentId: assignment.id,
                                  channelId,
                                })}
                              >
                                Move to this group
                              </Button>
                            </div>
                          ) : null}
                          {mixedPurpose ? <p className="pb-2 pl-8 text-xs text-[var(--amber)]">Choose channels with the same purpose.</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
                <FieldError message={errors.find((item) => item.id === `meter-assignment-${assignmentIndex + 1}`)?.message} />
                <FieldError message={errors.find((item) => item.id === `meter-assignment-${assignmentIndex + 1}-target`)?.message} />
              </div>
              );
            })}
          </div>
          </div>
        </Card>

        {showWattwatchersSections ? (
          <Card id="meter-verification" tabIndex={-1} className="scroll-mt-4">
            <h2 className="font-extrabold text-[var(--text)]">Verification & commissioning</h2>
            <div className="mt-3 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-sub)]">Verification</h3>
                {verificationQuestions.map(([key, label]) => (
                  <Checkbox key={key} label={label} checked={Boolean(draft.wwVerification?.[key])} disabled={Boolean(commissionedForm)} onChange={(checked) => setVerification(key, checked)} />
                ))}
                <FieldLabel>Verification notes</FieldLabel>
                <Textarea value={draft.wwVerification?.notes ?? ''} onChange={(event) => setVerification('notes', event.target.value)} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[var(--text-sub)]">Commissioning</h3>
                {commissioningQuestions.map(([key, label]) => (
                  <Checkbox key={key} label={label} checked={Boolean(draft.wwCommissioning?.[key])} disabled={Boolean(commissionedForm)} onChange={(checked) => setCommissioning(key, checked)} />
                ))}
                <FieldLabel>Commissioning notes</FieldLabel>
                <Textarea value={draft.wwCommissioning?.notes ?? ''} onChange={(event) => setCommissioning('notes', event.target.value)} />
              </div>
            </div>
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save meter'}</Button>
          <Button
            variant="secondary"
            onClick={() => requestTreeNavigation(
              () => assetReturn
                ? router.replace(assetMeterReturnHref(installationId, assetReturn))
                : router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}`),
              assetReturn ? 'the preserved site asset draft' : 'the switchboard',
            )}
            disabled={busy}
          >
            {assetReturn ? 'Return to asset without adding device' : 'Cancel'}
          </Button>
        </div>
        </fieldset>
      </form>

      <ConfirmDialog
        open={Boolean(assetQuickAdd)}
        title="Add a site asset from this meter"
        description={assetQuickAdd?.channelId
          ? 'Create the physical asset and attach this sub-circuit channel to it in the same meter draft.'
          : assetQuickAdd?.assignmentId
            ? 'Create the physical asset and select it for this measurement group.'
            : 'Create the physical asset now, then choose the channel or channels measured by its new group.'}
        consequences={[
          `Its confirmed electrical supply will be ${board.assetName}`,
          'Its physical zone defaults to this meter’s zone and can be changed below',
          'The asset and its measurement assignment are saved atomically when you save the meter',
        ]}
        confirmLabel="Create and select asset"
        danger={false}
        busy={busy}
        blockedMessage={tree.installation.status === 'Completed'
          ? 'Reopen this completed installation before adding a site asset.'
          : undefined}
        onConfirm={confirmQuickAsset}
        onCancel={() => {
          setAssetQuickAdd(null);
          setQuickAssetErrors([]);
        }}
      >
        <div className="space-y-3">
          <div>
            <FieldLabel htmlFor="quick-asset-zone">Physical zone</FieldLabel>
            <SearchableSelect
              id="quick-asset-zone"
              value={quickAssetZoneId}
              options={tree.zones.map((item) => ({
                value: item.id,
                label: `${item.zoneName}${item.zoneCode ? ` · ${item.zoneCode}` : ''}`,
                keywords: item.id,
              }))}
              placeholder="Search and choose the asset’s physical zone"
              emptyMessage="No physical zones match this search."
              disabled={busy}
              invalid={quickAssetErrors.some((item) => item.id === 'quick-asset-zone')}
              describedBy="quick-asset-zone-hint quick-asset-zone-error"
              onChange={setQuickAssetZoneId}
            />
            <FieldHint id="quick-asset-zone-hint">Choose where the asset itself is physically located; it does not have to match the meter’s zone.</FieldHint>
            <FieldError id="quick-asset-zone-error" message={quickAssetErrors.find((item) => item.id === 'quick-asset-zone')?.message} />
          </div>
          <div>
            <FieldLabel htmlFor="quick-asset-type">Asset type</FieldLabel>
            <Select id="quick-asset-type" value={quickAssetTypeCode} disabled={busy} onChange={(event) => changeQuickAssetType(event.target.value)}>
              {SITE_ASSET_TYPE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </Select>
          </div>
          {quickAssetTypeCode === 'OTHER' ? (
            <div>
              <FieldLabel htmlFor="quick-asset-custom-type">Custom asset type</FieldLabel>
              <Input
                id="quick-asset-custom-type"
                value={quickAssetCustomType}
                disabled={busy}
                aria-invalid={quickAssetErrors.some((item) => item.id === 'quick-asset-custom-type')}
                onChange={(event) => changeQuickAssetCustomType(event.target.value)}
              />
              <FieldError message={quickAssetErrors.find((item) => item.id === 'quick-asset-custom-type')?.message} />
            </div>
          ) : null}
          <div>
            <FieldLabel htmlFor="quick-asset-name">Site asset name</FieldLabel>
            <Input
              id="quick-asset-name"
              value={quickAssetName}
              disabled={busy}
              maxLength={ENTITY_NAME_MAX_LENGTH}
              aria-invalid={quickAssetErrors.some((item) => item.id === 'quick-asset-name')}
              onChange={(event) => setQuickAssetName(event.target.value)}
            />
            <FieldError message={quickAssetErrors.find((item) => item.id === 'quick-asset-name')?.message} />
          </div>
          {quickAssetPreview ? (
            <div>
              <FieldLabel htmlFor="quick-asset-id">Generated asset ID preview</FieldLabel>
              <Input id="quick-asset-id" readOnly value={quickAssetPreview.value} />
              <FieldHint>The server confirms the shared zone sequence when the meter is saved.</FieldHint>
            </div>
          ) : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingAssetRemap)}
        title={`Move ${pendingRemapTarget?.name || 'this site asset'} to this device?`}
        description={pendingRemapTarget && pendingRemapDevice
          ? `${pendingRemapTarget.label} is currently measured by ${pendingRemapDevice.device ? humanDeviceName(pendingRemapDevice.device) : pendingAssetRemap?.existingAssignment.meterId}${pendingRemapDevice.installedBoard ? ` on ${pendingRemapDevice.installedBoard.assetName}` : ''}. This explicit reassignment is applied atomically when you save.`
          : 'This explicit site-asset reassignment is applied atomically when you save.'}
        consequences={[
          pendingRemapDevice?.channelOrdinals.length
            ? `The old device group using channel${pendingRemapDevice.channelOrdinals.length === 1 ? '' : 's'} ${pendingRemapDevice.channelOrdinals.join(', ')} will be released`
            : 'The old device measurement group will be released',
          'The site asset will remain metered and move to the channel group you complete on this device',
          'No second active assignment will be created',
        ]}
        confirmLabel="Approve reassignment"
        busy={busy}
        blockedMessage={tree.installation.status === 'Completed' ? 'Reopen this completed installation before reassigning a site asset.' : undefined}
        onConfirm={approveAssetRemap}
        onCancel={() => setPendingAssetRemap(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDraftChannelMove)}
        title="Move this channel to the selected measurement group?"
        description={pendingMoveFromTarget && pendingMoveToTarget
          ? `The channel is currently part of ${pendingMoveFromTarget.label}. It will move to ${pendingMoveToTarget.label} in this draft.`
          : 'The channel will move from its current measurement group to this group in the draft.'}
        consequences={[
          pendingMoveFromTarget ? `The full ${pendingMoveFromTarget.label} group will be released` : 'The full previous measurement group will be released',
          pendingMoveFrom?.target.kind === 'SITE_ASSET'
            ? `${pendingMoveFromTarget?.name || 'The displaced site asset'} will be changed to To be confirmed when saved`
            : 'The previous target will no longer have this device assignment when saved',
          'This channel will be selected here; add any other observed phase channels if applicable',
        ]}
        confirmLabel="Move channel"
        busy={busy}
        blockedMessage={tree.installation.status === 'Completed' ? 'Reopen this completed installation before changing channel groups.' : undefined}
        onConfirm={approveDraftChannelMove}
        onCancel={() => setPendingDraftChannelMove(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={dependencyPreview.heading}
        description="This Draft-only action soft-deletes the active meter, its channels, assignments, and any linked draft form. Assigned site assets return to TBC. The exact commissioned meter, completed WW form, photos, and pinned record version remain immutable in history."
        consequences={dependencyPreview.consequences}
        confirmLabel="Soft-delete active meter"
        busy={busy}
        blockedMessage={dependencyPreview.blocked
          ? 'Reopen this completed installation before removing a metering device.'
          : undefined}
        onConfirm={() => void removeMeter()}
        onCancel={() => setConfirmDelete(false)}
      />

      {!saved ? (
        <InlineNotice>
          {showWattwatchersSections
            ? 'Save the meter first, then capture evidence and create communications fault records.'
            : 'Save the meter first, then capture evidence.'}
        </InlineNotice>
      ) : (
        <Card id="meter-evidence" tabIndex={-1} className="mt-5 scroll-mt-4">
          <h2 className="font-extrabold text-[var(--text)]">Meter evidence</h2>
          {photoFields.map(({ slot, label }) => {
            const uri = latest.wwPhotos?.[slot];
            return (
              <EvidenceField
                key={slot}
                id={`meter-photo-${slot}`}
                label={label}
                items={uri ? [{ id: slot, uri }] : []}
                busy={uploading || busy || writer.hasPendingTree}
                onFiles={(files) => uploadSingle(slot, files)}
                onRemove={uri ? () => removePhoto(slot) : undefined}
              />
            );
          })}
          <EvidenceField
            id="meter-extra-photos"
            label="Extra meter photos"
            items={(latest.wwPhotos?.extra ?? []).map((uri, index) => ({ id: `${index}`, uri }))}
            busy={uploading || busy || writer.hasPendingTree}
            onFiles={uploadExtra}
            onRemove={latest.wwPhotos?.extra?.length ? (id) => removePhoto('extra', id) : undefined}
          />
        </Card>
      )}
    </div>
  );
}
