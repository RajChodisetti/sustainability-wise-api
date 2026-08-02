'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed meter editor from its server query record */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldError, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, InlineNotice } from '@/modules/installhub/components/InstallHubUi';
import { ScannerInput } from '@/modules/installhub/components/ScannerInput';
import {
  ConfirmDialog,
  ErrorSummary,
  SaveStateNotice,
  TreeDraftNavigationGuard,
  requestTreeNavigation,
} from '@/modules/installhub/components/WorkflowUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { uploadInstallationPhoto } from '@/modules/installhub/api/installhub';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import { createMeter, nowIso } from '@/modules/installhub/lib/model';
import type {
  Meter,
  MeasurementAssignment,
  WattwatcherCommissioning,
  WattwatcherPrestart,
  WattwatcherSwitchboard,
  WattwatcherVerification,
} from '@/modules/installhub/types/domain';
import {
  CHANNEL_PURPOSE_OPTIONS,
  assignmentForAsset,
  assetElectricalSource,
  boardSupplyPath,
  displayCodeMetadata,
  displayCodeValue,
  measurementAssignments,
  meterChannelId,
  meterDependencyPreview,
  meterEditorHasChanges,
  meterBoardsForAsset,
  meterDevices,
  reachableGridSuppliesForBoard,
  replaceMeterAssignments,
  syncMeterDevice,
} from '@/modules/installhub/lib/workflow';
import { createInstallHubId } from '@/modules/installhub/lib/id';
import {
  assetMeterReturnHref,
  assetMeterReturnRequest,
  pinSelectedResult,
  type AssetMeterReturnRequest,
} from '@/modules/installhub/lib/electricalPresentation';
import { useToast } from '@/contexts/ToastContext';

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
  '3000A - 9cm',
  '3000A - 20cm',
  '3000A - 29cm',
] as const;
const CT_RATINGS = ['60A', '120A', '200A', '400A', '600A'] as const;

function withLegacyOption(
  options: readonly string[],
  current?: string,
): string[] {
  if (!current || options.includes(current)) return [...options];
  return [current, ...options];
}

export function InstallHubMeterPage({ mode }: { mode: 'new' | 'edit' }) {
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
  const [draft, setDraft] = useState<Meter | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Array<{ id?: string; message: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<MeasurementAssignment[]>([]);
  const [targetSearches, setTargetSearches] = useState<Record<string, string>>({});
  const [assetReturn, setAssetReturn] = useState<AssetMeterReturnRequest | null>(null);

  useEffect(() => {
    if (mode !== 'new') return;
    setAssetReturn(assetMeterReturnRequest(new URLSearchParams(window.location.search)));
  }, [mode]);

  const board = query.data?.electricalAssets.find((item) => item.id === boardId);
  const source = board?.meters.find((item) => item.id === meterId);
  useEffect(() => {
    if (mode === 'new') setDraft((current) => current ?? createMeter());
    else if (source) {
      setDraft(structuredClone(source));
      setAssignmentDrafts(
        measurementAssignments(query.data!).filter(
          (assignment) => assignment.meterId === source.id,
        ).map((assignment) => structuredClone(assignment)),
      );
    }
  }, [mode, query.data, source]);

  if (query.isLoading || !draft) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!board) return <ErrorBanner message="Switchboard not found." />;
  if (mode === 'edit' && !source) return <ErrorBanner message="Meter not found." />;
  const tree = query.data!;
  const zone = tree.zones.find((item) => item.id === zoneId);
  const saved = mode === 'edit';
  const currentDraft = draft;
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
  const existingDevice = meterDevices(tree).find((meter) => meter.id === draft.id);
  const meterDisplayMeta = displayCodeMetadata(
    tree,
    draft.deviceType === 'Other' ? 'OTHER' : draft.deviceType,
    draft.deviceNameOverridden ? draft.deviceName : '',
    existingDevice?.displayName,
    draft.id,
  );
  const generatedDeviceName = meterDisplayMeta.value;
  const sourceAssignments = source
    ? measurementAssignments(tree).filter((assignment) => assignment.meterId === source.id)
    : [];
  const hasLocalChanges = meterEditorHasChanges(
    draft,
    source,
    assignmentDrafts,
    sourceAssignments,
    mode,
  );
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

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const nextErrors: Array<{ id?: string; message: string }> = [];
    if (!currentDraft.deviceName.trim()) nextErrors.push({ id: 'meter-name', message: 'Enter or generate the device name.' });
    if (!currentDraft.deviceId.trim()) nextErrors.push({ id: 'meter-serial', message: 'Enter or scan the device ID / serial.' });
    if (currentDraft.deviceType === 'Other' && !currentDraft.customModelName?.trim()) {
      nextErrors.push({ id: 'meter-custom-model', message: 'Enter the custom device model.' });
    }
    if (currentDraft.deviceFamily === 'OTHER' && !currentDraft.customManufacturerName?.trim()) {
      nextErrors.push({ id: 'meter-custom-manufacturer', message: 'Enter the custom manufacturer.' });
    }
    const channels = currentDraft.wwChannels || [];
    const expectedChannelCount = currentDraft.deviceType === 'A3RM' ? 3 : currentDraft.deviceType === 'A6M' ? 6 : null;
    if (expectedChannelCount !== null && channels.length !== expectedChannelCount) {
      nextErrors.push({ id: 'meter-channels', message: `${currentDraft.deviceType} requires exactly ${expectedChannelCount} channels.` });
    } else if (currentDraft.deviceType === 'Other' && channels.length < 1) {
      nextErrors.push({ id: 'meter-channels', message: 'Add at least one channel for the custom device.' });
    }
    channels.forEach((channel, index) => {
      if (channel.purpose !== 'SPARE' && channel.loadType === 'Other' && !channel.customLoadTypeName?.trim()) {
        nextErrors.push({ id: `meter-channel-${index + 1}-custom`, message: `Enter the custom load type for channel ${index + 1}.` });
      }
      if (currentDraft.deviceType === 'Other') {
        const capabilityEntries = Object.entries(channel.capabilities || {});
        if (
          capabilityEntries.length === 0
          || capabilityEntries.some(([key, value]) => !key.trim() || (typeof value === 'string' && !value.trim()) || value === null || value === undefined)
        ) {
          nextErrors.push({
            id: `meter-channel-${index + 1}-capabilities`,
            message: `Add at least one named, non-empty capability for custom channel ${index + 1}.`,
          });
        }
      }
    });
    const purposeByChannelId = new Map(channels.map((channel, index) => [
      channel.id || meterChannelId(currentDraft.id, index),
      channel.purpose || 'SPARE',
    ]));
    const usedIds = new Set<string>();
    const usedSiteAssetTargets = new Set<string>();
    assignmentDrafts.forEach((assignment, index) => {
      if (assignment.target.kind === 'SITE_ASSET') {
        const existingAssignment = assignmentForAsset(tree, assignment.target.siteAssetId);
        if (usedSiteAssetTargets.has(assignment.target.siteAssetId)) {
          nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'A site asset may have only one active measurement assignment.' });
        }
        if (existingAssignment && existingAssignment.meterId !== currentDraft.id) {
          nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'This site asset is already measured by another meter. Remove or reassign that measurement explicitly first.' });
        }
        usedSiteAssetTargets.add(assignment.target.siteAssetId);
      }
      const expected = assignment.phaseMode === 'SINGLE_PHASE' ? 1 : assignment.phaseMode === 'THREE_PHASE' ? 3 : assignment.channelIds.length;
      if (!expected || assignment.channelIds.length !== expected || new Set(assignment.channelIds).size !== expected) {
        nextErrors.push({ id: `meter-assignment-${index + 1}`, message: `Choose ${assignment.phaseMode === 'THREE_PHASE' ? 'three' : assignment.phaseMode === 'SINGLE_PHASE' ? 'one' : 'one or more'} distinct channel${assignment.phaseMode === 'SINGLE_PHASE' ? '' : 's'} for assignment ${index + 1}.` });
      }
      if (assignment.channelIds.some((channelId) => usedIds.has(channelId))) {
        nextErrors.push({ id: `meter-assignment-${index + 1}`, message: `Assignment ${index + 1} reuses a channel from another active assignment.` });
      }
      assignment.channelIds.forEach((channelId) => usedIds.add(channelId));
      const purposes = new Set(assignment.channelIds.map((channelId) => purposeByChannelId.get(channelId)));
      if (purposes.size > 1 || purposes.has('SPARE') || purposes.has(undefined)) {
        nextErrors.push({ id: `meter-assignment-${index + 1}`, message: `Assignment ${index + 1} must use channels with one shared non-spare purpose.` });
      }
      const purpose = purposes.size === 1 ? [...purposes][0] : undefined;
      if (purpose === 'MAIN_SUPPLY' && !['BOARD', 'GRID_BOUNDARY', 'TBC'].includes(assignment.target.kind)) {
        nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'Main-supply channels require this installed switchboard, a Grid boundary, or an explicit TBC target.' });
      }
      if (purpose === 'MAIN_SUPPLY' && assignment.target.kind === 'BOARD' && assignment.target.boardId !== boardId) {
        nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'A main-supply board total must target the switchboard where this device is installed.' });
      }
      if (purpose === 'SUB_CIRCUIT' && assignment.target.kind === 'GRID_BOUNDARY') {
        nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'Sub-circuit channels cannot target a Grid boundary.' });
      }
      if (purpose === 'SUB_CIRCUIT' && assignment.target.kind === 'BOARD' && (
        assignment.target.boardId === boardId
        || !boardSupplyPath(tree, assignment.target.boardId).includes(boardId)
      )) {
        nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'Sub-circuit channels must target a downstream switchboard or site asset.' });
      }
      if (assignment.target.kind === 'BOARD' && !assignment.target.boardId) {
        nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: `Choose the target switchboard for assignment ${index + 1}.` });
      }
      if (assignment.target.kind === 'SITE_ASSET' && !assignment.target.siteAssetId) {
        nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: `Choose the target site asset for assignment ${index + 1}.` });
      }
      if (assignment.target.kind === 'GRID_BOUNDARY' && !assignment.target.gridSupplyId) {
        nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: `Choose the Grid boundary for assignment ${index + 1}.` });
      }
      if (assignment.target.kind === 'GRID_BOUNDARY') {
        const gridSupplyId = assignment.target.gridSupplyId;
        if (!reachableGridSupplies.some((supply) => supply.id === gridSupplyId)) {
          nextErrors.push({ id: `meter-assignment-${index + 1}-target`, message: 'Choose a Grid boundary reachable upstream from this device’s installed switchboard.' });
        }
      }
    });
    const unassigned = [...purposeByChannelId].filter(
      ([channelId, purpose]) => purpose !== 'SPARE' && !usedIds.has(channelId),
    );
    if (unassigned.length && !assetReturn) {
      nextErrors.push({
        id: 'meter-assignments',
        message: `Assign every active channel. ${unassigned.map(([channelId]) => channelId).join(', ')} ${unassigned.length === 1 ? 'is' : 'are'} unresolved.`,
      });
    }
    setErrors(nextErrors);
    if (nextErrors.length) {
      document.getElementById(nextErrors[0].id || '')?.focus();
      toast.error('Check the highlighted metering fields.');
      return;
    }
    setBusy(true);
    try {
      await writer.mutate((next) => {
        const targetBoard = next.electricalAssets.find((item) => item.id === boardId);
        if (!targetBoard) throw new Error('Switchboard not found.');
        const editableDraft = commissionedForm && source ? {
          ...structuredClone(source),
          deviceName: currentDraft.deviceName,
          deviceNameOverridden: currentDraft.deviceNameOverridden,
          wwSwitchboard: { ...source.wwSwitchboard, notes: currentDraft.wwSwitchboard?.notes },
          wwVerification: { ...source.wwVerification, notes: currentDraft.wwVerification?.notes },
          wwCommissioning: { ...source.wwCommissioning, notes: currentDraft.wwCommissioning?.notes },
          notes: currentDraft.notes,
        } : structuredClone(currentDraft);
        const editableChannels = editableDraft.wwChannels || [];
        const value: Meter = {
          ...editableDraft,
          deviceName: currentDraft.deviceName.trim(),
          deviceId: editableDraft.deviceId.trim(),
          customManufacturerName: editableDraft.deviceFamily === 'OTHER' ? editableDraft.customManufacturerName?.trim() : null,
          customModelName: editableDraft.deviceType === 'Other' ? editableDraft.customModelName?.trim() : null,
          lifecycleState: 'ACTIVE',
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
        replaceMeterAssignments(next, value.id, assignmentDrafts);
      });
      setErrors([]);
      toast.success(saved ? 'Meter saved.' : 'Meter added.');
      if (!saved) {
        router.replace(assetReturn
          ? assetMeterReturnHref(installationId, assetReturn, currentDraft.id)
          : `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/${currentDraft.id}`);
      }
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
    const file = files[0];
    if (!file || !meterId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
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
      toast.success('Meter evidence uploaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function uploadExtra(files: File[]) {
    if (!meterId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
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
    try {
      await writer.mutate((next) => {
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
      toast.success('Meter photo removed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeMeter() {
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
          customManufacturerName: null,
          customModelName: null,
          wwChannels: channels,
        };
      }
      return {
        ...current,
        deviceFamily: value,
        deviceType: 'Other',
        deviceName: current.deviceNameOverridden
          ? current.deviceName
          : displayCodeMetadata(
              tree,
              'OTHER',
              '',
              existingDevice?.displayName,
              current.id,
              !saved,
            ).value,
        wwChannels: current.wwChannels?.length ? current.wwChannels : [{ id: meterChannelId(current.id, 0), ordinal: 1, purpose: 'SPARE' }],
      };
    });
  }

  function chooseDeviceType(type: Meter['deviceType']) {
    setDraft((current) => {
      if (!current) return current;
      const count = type === 'A3RM' ? 3 : type === 'A6M' ? 6 : Math.max(1, current.wwChannels?.length || 1);
      const nextDisplay = displayCodeMetadata(
        tree,
        type === 'Other' ? 'OTHER' : type,
        '',
        existingDevice?.displayName,
        current.id,
        !saved,
      );
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
        customModelName: type === 'Other' ? current.customModelName : null,
        deviceName: current.deviceNameOverridden
          ? current.deviceName
          : nextDisplay.value,
        wwChannels: channels,
      };
    });
  }

  function setDeviceNameOverride(checked: boolean) {
    setDraft((current) => current ? {
      ...current,
      deviceNameOverridden: checked,
      deviceName: checked
        ? current.deviceName
        : displayCodeMetadata(tree, current.deviceType === 'Other' ? 'OTHER' : current.deviceType, '', undefined, current.id).value,
    } : current);
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
          id: meterChannelId(current.id, index),
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

  function renameCapability(index: number, priorKey: string, nextKey: string) {
    const capabilities = { ...(currentDraft.wwChannels?.[index]?.capabilities || {}) };
    const value = capabilities[priorKey];
    delete capabilities[priorKey];
    if (nextKey) capabilities[nextKey] = value;
    setChannelCapabilities(index, capabilities);
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

  function targetSearch(assignmentId: string): string {
    return targetSearches[assignmentId] || '';
  }

  function assignmentBoardCandidates(assignment: MeasurementAssignment) {
    const normalized = targetSearch(assignment.id).trim().toLowerCase();
    const selectedId = assignment.target.kind === 'BOARD' ? assignment.target.boardId : '';
    const purpose = assignmentPurpose(assignment);
    const allCandidates = tree.electricalAssets
      .filter((item) => purpose === 'MAIN_SUPPLY'
        ? item.id === boardId
        : purpose === 'SUB_CIRCUIT'
          ? item.id !== boardId && boardSupplyPath(tree, item.id).includes(boardId)
          : item.id === boardId || boardSupplyPath(tree, item.id).includes(boardId))
      .sort((left, right) => left.id.localeCompare(right.id));
    const matching = allCandidates.filter((item) => {
      const zoneName = tree.zones.find((zone) => zone.id === item.zoneId)?.zoneName || '';
      return !normalized || `${displayCodeValue(item)} ${item.assetName} ${zoneName}`.toLowerCase().includes(normalized);
    });
    return pinSelectedResult(matching, allCandidates, selectedId, (item) => item.id);
  }

  function assignmentAssetCandidates(assignment: MeasurementAssignment) {
    const normalized = targetSearch(assignment.id).trim().toLowerCase();
    const selectedId = assignment.target.kind === 'SITE_ASSET' ? assignment.target.siteAssetId : '';
    const allCandidates = tree.siteAssets
      .filter((item) => {
        const existingAssignment = assignmentForAsset(tree, item.id);
        if (existingAssignment && existingAssignment.meterId !== currentDraft.id) return false;
        if (item.id === selectedId) return true;
        if (assetElectricalSource(item).kind !== 'BOARD') return false;
        return meterBoardsForAsset(tree, item).some((candidate) => candidate.id === boardId);
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const matching = allCandidates.filter((item) => {
      const zoneName = tree.zones.find((zone) => zone.id === item.zoneId)?.zoneName || '';
      return !normalized || `${displayCodeValue(item)} ${item.assetName} ${zoneName}`.toLowerCase().includes(normalized);
    });
    return pinSelectedResult(matching, allCandidates, selectedId, (item) => item.id);
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

  const photoFields: Array<{
    slot: 'deviceInstalled' | 'switchboardOverview' | 'labeling';
    label: string;
  }> = [
    { slot: 'deviceInstalled', label: 'Installed device' },
    { slot: 'switchboardOverview', label: 'Switchboard overview' },
    { slot: 'labeling', label: 'Device and channel labeling' },
  ];

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: zone?.zoneName ?? 'Zone', href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: board.assetName, href: `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}` },
        { label: mode === 'new' ? 'New meter' : draft.deviceName },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'New Wattwatcher meter' : draft.deviceName}
        subtitle="Device identity, safety, switchboard, channels, verification, commissioning, and evidence."
        actions={saved ? (
          <>
            {commissionedForm ? (
              <LinkButton href={`/installhub/installations/${installationId}/forms/${commissionedForm.id}`} variant="secondary">
                <Icon name="clipboard" size={17} />View record / amend
              </LinkButton>
            ) : null}
            <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&boardId=${boardId}&meterId=${meterId}`}>
              <Icon name="tool" size={17} />Comms fault form
            </LinkButton>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Remove</Button>
          </>
        ) : undefined}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-sub)]">
          Installed on: <strong className="text-[var(--text)]">{board.displayCode} — {board.assetName}</strong>
        </p>
        <SaveStateNotice
          state={writer.writeState}
          onRetry={() => void writer.retry().catch((error) => toast.error(installHubConnectionErrorMessage(error)))}
          onDiscard={() => void writer.discard()}
        />
      </div>
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

      <form onSubmit={(event) => void save(event)} className="space-y-5">
        <Card>
          <h2 className="font-extrabold text-[var(--text)]">Device identity</h2>
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="meter-family">Device family *</FieldLabel>
              <Select id="meter-family" value={draft.deviceFamily || 'WATTWATCHERS'} disabled={Boolean(commissionedForm)} onChange={(event) => chooseDeviceFamily(event.target.value as 'WATTWATCHERS' | 'OTHER')}>
                <option value="WATTWATCHERS">Wattwatchers</option>
                <option value="OTHER">Other manufacturer</option>
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="meter-model">Device model *</FieldLabel>
              <Select
                id="meter-model"
                value={draft.deviceType}
                disabled={Boolean(commissionedForm)}
                onChange={(event) => chooseDeviceType(event.target.value as Meter['deviceType'])}
              >
                {draft.deviceFamily !== 'OTHER' ? <option>A3RM</option> : null}
                {draft.deviceFamily !== 'OTHER' ? <option>A6M</option> : null}
                <option>Other</option>
              </Select>
            </div>
            {draft.deviceFamily === 'OTHER' ? (
              <div>
                <FieldLabel htmlFor="meter-custom-manufacturer">Manufacturer *</FieldLabel>
                <Input id="meter-custom-manufacturer" value={draft.customManufacturerName ?? ''} disabled={Boolean(commissionedForm)} aria-invalid={errors.some((item) => item.id === 'meter-custom-manufacturer')} onChange={(event) => set('customManufacturerName', event.target.value)} />
                <FieldError message={errors.find((item) => item.id === 'meter-custom-manufacturer')?.message} />
              </div>
            ) : null}
            {draft.deviceType === 'Other' ? (
              <div>
                <FieldLabel htmlFor="meter-custom-model">Custom model *</FieldLabel>
                <Input id="meter-custom-model" value={draft.customModelName ?? ''} disabled={Boolean(commissionedForm)} aria-invalid={errors.some((item) => item.id === 'meter-custom-model')} onChange={(event) => set('customModelName', event.target.value)} />
                <FieldError message={errors.find((item) => item.id === 'meter-custom-model')?.message} />
              </div>
            ) : null}
            <div>
              <FieldLabel htmlFor="meter-name">Device name *</FieldLabel>
              <Input
                id="meter-name"
                value={draft.deviceNameOverridden ? draft.deviceName : generatedDeviceName}
                readOnly={!draft.deviceNameOverridden}
                required
                aria-invalid={errors.some((item) => item.id === 'meter-name')}
                onChange={(event) => set('deviceName', event.target.value)}
              />
              <FieldHint>Generated from the model unless deliberately overridden.</FieldHint>
              <FieldError message={errors.find((item) => item.id === 'meter-name')?.message} />
              <Checkbox label="Use a custom device name" checked={Boolean(draft.deviceNameOverridden)} onChange={setDeviceNameOverride} />
            </div>
            <div>
              <FieldLabel>Device ID / serial *</FieldLabel>
              <div id="meter-serial" tabIndex={-1}>
                <ScannerInput value={draft.deviceId} onChange={(value) => set('deviceId', value)} modes={['barcode', 'qr']} disabled={Boolean(commissionedForm)} />
              </div>
              <FieldError message={errors.find((item) => item.id === 'meter-serial')?.message} />
            </div>
            <div>
              <FieldLabel>Device number</FieldLabel>
              <ScannerInput value={draft.deviceNumber ?? ''} onChange={(value) => set('deviceNumber', value)} modes={['barcode', 'qr']} disabled={Boolean(commissionedForm)} />
            </div>
            <div>
              <FieldLabel>Classification</FieldLabel>
              <Input value={draft.classification ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => set('classification', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Coverage</FieldLabel>
              <Input value={draft.coverage ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => set('coverage', event.target.value)} />
            </div>
          </div>
          <FieldLabel htmlFor="meter-notes">Operational notes</FieldLabel>
          <Textarea id="meter-notes" value={draft.notes ?? ''} onChange={(event) => set('notes', event.target.value)} />
        </Card>

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
              <Input value={draft.wwSwitchboard?.antennaType ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => setSwitchboard('antennaType', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Signal</FieldLabel>
              <Input value={draft.wwSwitchboard?.signalStrength ?? ''} disabled={Boolean(commissionedForm)} onChange={(event) => setSwitchboard('signalStrength', event.target.value)} />
            </div>
          </div>
          <FieldLabel>Notes</FieldLabel>
          <Textarea value={draft.wwSwitchboard?.notes ?? ''} onChange={(event) => setSwitchboard('notes', event.target.value)} />
        </Card>

        <Card>
          <div id="meter-channels" tabIndex={-1}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Channels</h2>
              <p className="mt-1 text-xs text-[var(--text-sub)]">Three channels for A3RM, six for A6M, or one or more explicit custom channels.</p>
            </div>
            {draft.deviceType === 'Other' && !commissionedForm ? (
              <Button variant="secondary" onClick={addCustomChannel}><Icon name="plus" size={16} />Add channel</Button>
            ) : null}
          </div>
          <FieldError message={errors.find((item) => item.id === 'meter-channels')?.message} />
          <div className="mt-4 space-y-3">
            {(draft.wwChannels ?? []).map((channel, index) => (
              <div key={index} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-[var(--text)]">Channel {index + 1}</h3>
                  {draft.deviceType === 'Other' && !commissionedForm ? (
                    <Button variant="ghost" className="text-[var(--red)]" onClick={() => removeCustomChannel(index)}><Icon name="trash" size={16} />Remove</Button>
                  ) : null}
                </div>
                <div className="grid gap-x-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <FieldLabel>Purpose</FieldLabel>
                    <Select
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
                        <FieldLabel>Load type</FieldLabel>
                        <Select
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
                          <FieldLabel htmlFor={`meter-channel-${index + 1}-custom`}>Custom load type *</FieldLabel>
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
                          <FieldLabel>CT rating</FieldLabel>
                          <Select
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
                          <FieldLabel>Rogowski coil</FieldLabel>
                          <Select
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
                        <FieldLabel>Description</FieldLabel>
                        <Input
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
                            <FieldLabel>Phase label</FieldLabel>
                            <Input
                              value={channel.phaseLabel ?? ''}
                              disabled={Boolean(commissionedForm)}
                              placeholder="e.g. L1, Red, Neutral"
                              onChange={(event) => updateChannel(index, { phaseLabel: event.target.value })}
                            />
                          </div>
                          <div>
                            <FieldLabel>Sensor rating / metadata</FieldLabel>
                            <Input
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
                            value={key}
                            disabled={Boolean(commissionedForm)}
                            onChange={(event) => renameCapability(index, key, event.target.value)}
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
          <div id="meter-assignments" tabIndex={-1}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Channel assignments</h2>
              <p className="mt-1 text-xs text-[var(--text-sub)]">Explicitly group same-purpose channels, phase mode, target, and direction. No phase or target is inferred.</p>
            </div>
            <Button
              variant="secondary"
              disabled={!(draft.wwChannels || []).some((channel) => channel.purpose && channel.purpose !== 'SPARE')}
              onClick={addAssignment}
            >
              <Icon name="plus" size={16} />Assign channels
            </Button>
          </div>
          <FieldError message={errors.find((item) => item.id === 'meter-assignments')?.message} />
          {!(draft.wwChannels || []).some((channel) => channel.purpose && channel.purpose !== 'SPARE') ? (
            <p className="mt-3 text-sm text-[var(--text-sub)]">Mark a channel as “Main board supply” or “Sub-circuit / asset” to create an assignment.</p>
          ) : null}
          <div className="mt-4 space-y-4">
            {assignmentDrafts.map((assignment, assignmentIndex) => (
              <div
                key={assignment.id}
                id={`meter-assignment-${assignmentIndex + 1}`}
                tabIndex={-1}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-bold text-[var(--text)]">Assignment {assignmentIndex + 1}</h3>
                  <Button variant="ghost" className="text-[var(--red)]" onClick={() => setAssignmentDrafts((current) => current.filter((_, index) => index !== assignmentIndex))}>
                    <Icon name="trash" size={16} />Remove
                  </Button>
                </div>
                <div className="grid gap-x-4 lg:grid-cols-3">
                  <div>
                    <FieldLabel>Phase group</FieldLabel>
                    <Select
                      value={assignment.phaseMode}
                      onChange={(event) => updateAssignment(assignmentIndex, {
                        phaseMode: event.target.value as MeasurementAssignment['phaseMode'],
                        channelIds: [],
                      })}
                    >
                      <option value="SINGLE_PHASE">Single phase — 1 channel</option>
                      <option value="THREE_PHASE">Three phase — 3 channels</option>
                      <option value="OTHER">Other grouping</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel>Target</FieldLabel>
                    <Select
                      value={assignment.target.kind}
                      onChange={(event) => chooseAssignmentTarget(assignmentIndex, event.target.value as 'BOARD' | 'GRID_BOUNDARY' | 'SITE_ASSET' | 'TBC')}
                    >
                      <option value="TBC">To be confirmed</option>
                      <option value="BOARD">Switchboard</option>
                      <option value="GRID_BOUNDARY" disabled={assignmentPurpose(assignment) === 'SUB_CIRCUIT'}>Grid boundary</option>
                      <option value="SITE_ASSET" disabled={assignmentPurpose(assignment) === 'MAIN_SUPPLY'}>Site asset</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel>Direction</FieldLabel>
                    <Select
                      value={assignment.direction}
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
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-search`}>Find a measured switchboard</FieldLabel>
                    <Input
                      id={`meter-assignment-${assignmentIndex + 1}-search`}
                      type="search"
                      value={targetSearch(assignment.id)}
                      placeholder="Search code or name"
                      onChange={(event) => setTargetSearches((current) => ({ ...current, [assignment.id]: event.target.value }))}
                    />
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-target`}>Measured switchboard *</FieldLabel>
                    <Select
                      id={`meter-assignment-${assignmentIndex + 1}-target`}
                      value={assignment.target.boardId}
                      onChange={(event) => updateAssignment(assignmentIndex, { target: { kind: 'BOARD', boardId: event.target.value }, status: 'CONFIRMED' })}
                    >
                      <option value="">Choose a switchboard</option>
                      {assignmentBoardCandidates(assignment).map((item) => (
                        <option key={item.id} value={item.id}>{displayCodeValue(item)} — {item.assetName}</option>
                      ))}
                    </Select>
                    <FieldHint>{assignmentPurpose(assignment) === 'MAIN_SUPPLY' ? 'A confirmed main-supply board total must target this device’s installed switchboard.' : assignmentPurpose(assignment) === 'SUB_CIRCUIT' ? 'Sub-circuit channels may target only a downstream switchboard.' : 'Choose channels to constrain the eligible switchboards. Showing up to 100 matches.'}</FieldHint>
                  </div>
                ) : null}
                {assignment.target.kind === 'SITE_ASSET' ? (
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-search`}>Find a measured site asset</FieldLabel>
                    <Input
                      id={`meter-assignment-${assignmentIndex + 1}-search`}
                      type="search"
                      value={targetSearch(assignment.id)}
                      placeholder="Search code or name"
                      onChange={(event) => setTargetSearches((current) => ({ ...current, [assignment.id]: event.target.value }))}
                    />
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-target`}>Measured site asset *</FieldLabel>
                    <Select
                      id={`meter-assignment-${assignmentIndex + 1}-target`}
                      value={assignment.target.siteAssetId}
                      onChange={(event) => updateAssignment(assignmentIndex, { target: { kind: 'SITE_ASSET', siteAssetId: event.target.value }, status: 'CONFIRMED' })}
                    >
                      <option value="">Choose a site asset</option>
                      {assignmentAssetCandidates(assignment).map((item) => (
                        <option key={item.id} value={item.id}>{displayCodeValue(item)} — {item.assetName}</option>
                      ))}
                    </Select>
                    <FieldHint>Only assets on this meter board’s confirmed supply path and not already measured by another meter are eligible. Showing up to 100 matches.</FieldHint>
                  </div>
                ) : null}
                {assignment.target.kind === 'GRID_BOUNDARY' ? (
                  <div>
                    <FieldLabel htmlFor={`meter-assignment-${assignmentIndex + 1}-target`}>Measured Grid boundary *</FieldLabel>
                    <Select
                      id={`meter-assignment-${assignmentIndex + 1}-target`}
                      value={assignment.target.gridSupplyId}
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

                <fieldset className="mt-4">
                  <legend className="text-sm font-bold text-[var(--text)]">Channels in this group *</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(draft.wwChannels || []).map((channel, channelIndex) => {
                      if (!channel.purpose || channel.purpose === 'SPARE') return null;
                      const channelId = channel.id || meterChannelId(draft.id, channelIndex);
                      const usedByAnother = assignmentDrafts.some(
                        (candidate, index) => index !== assignmentIndex && candidate.channelIds.includes(channelId),
                      );
                      const mixedPurpose = Boolean(assignmentPurpose(assignment) && assignmentPurpose(assignment) !== channel.purpose);
                      return (
                        <div key={channelId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
                          <Checkbox
                            label={`Channel ${channelIndex + 1} — ${channel.description || channel.loadType || 'Sub-circuit'}`}
                            checked={assignment.channelIds.includes(channelId)}
                            disabled={usedByAnother || mixedPurpose}
                            onChange={(checked) => toggleAssignmentChannel(assignmentIndex, channelId, checked)}
                          />
                          {usedByAnother ? <p className="pb-2 pl-8 text-xs text-[var(--amber)]">Used by another group.</p> : null}
                          {mixedPurpose ? <p className="pb-2 pl-8 text-xs text-[var(--amber)]">Choose channels with the same purpose.</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
                <FieldError message={errors.find((item) => item.id === `meter-assignment-${assignmentIndex + 1}`)?.message} />
                <FieldError message={errors.find((item) => item.id === `meter-assignment-${assignmentIndex + 1}-target`)?.message} />
              </div>
            ))}
          </div>
          </div>
        </Card>

        <Card>
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

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save meter'}</Button>
          <Button
            variant="secondary"
            onClick={() => requestTreeNavigation(
              () => assetReturn
                ? router.replace(assetMeterReturnHref(installationId, assetReturn))
                : router.back(),
              assetReturn ? 'the preserved site asset draft' : 'the previous page',
            )}
            disabled={busy}
          >
            {assetReturn ? 'Return to asset without adding device' : 'Cancel'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title={dependencyPreview.heading}
        description="This Draft-only action soft-deletes the active meter, its channels, assignments, and any linked draft form. Assigned site assets return to TBC. The exact commissioned meter, completed WW form, photos, and pinned record version remain immutable in history."
        consequences={dependencyPreview.consequences}
        confirmLabel="Soft-delete active meter"
        blockedMessage={dependencyPreview.blocked
          ? 'Reopen this completed installation before removing a metering device.'
          : undefined}
        onConfirm={() => void removeMeter()}
        onCancel={() => setConfirmDelete(false)}
      />

      {!saved ? (
        <InlineNotice>Save the meter first, then capture evidence and create communications fault records.</InlineNotice>
      ) : (
        <Card id="meter-evidence" className="mt-5">
          <h2 className="font-extrabold text-[var(--text)]">Meter evidence</h2>
          {photoFields.map(({ slot, label }) => {
            const uri = latest.wwPhotos?.[slot];
            return (
              <EvidenceField
                key={slot}
                label={label}
                items={uri ? [{ id: slot, uri }] : []}
                busy={uploading}
                onFiles={(files) => uploadSingle(slot, files)}
                onRemove={uri ? () => removePhoto(slot) : undefined}
              />
            );
          })}
          <EvidenceField
            label="Extra meter photos"
            items={(latest.wwPhotos?.extra ?? []).map((uri, index) => ({ id: `${index}`, uri }))}
            busy={uploading}
            onFiles={uploadExtra}
            onRemove={latest.wwPhotos?.extra?.length ? (id) => removePhoto('extra', id) : undefined}
          />
        </Card>
      )}
    </div>
  );
}
