import {
  FORM_DEFINITIONS,
  createInitialFormAnswers,
  meterAfterCommsReplacement,
} from '@/modules/installhub/forms/catalog';
import type { FormDefinition } from '@/modules/installhub/forms/catalog';
import type {
  ElectricalAsset,
  FormAttachment,
  FormSubmission,
  FormType,
  InstallationTree,
  InstallHubUser,
  Meter,
  SiteAsset,
  Zone,
} from '@/modules/installhub/types/domain';
import { createInstallHubId } from '@/modules/installhub/lib/id';

export function createId(prefix: string): string {
  return createInstallHubId(prefix);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return nowIso().slice(0, 10);
}

export function cloneTree(tree: InstallationTree): InstallationTree {
  return structuredClone(tree);
}

export function createInstallationTree(
  input: {
    clientName: string;
    siteName: string;
    siteAddress: string;
    inspectorName: string;
    auditDate: string;
    siteCode?: string;
    timezone?: string;
  },
  user: InstallHubUser,
): InstallationTree {
  const timestamp = nowIso();
  const installationId = createId('installation');
  return {
    treeSchemaVersion: 2,
    baseTreeRevision: 0,
    treeRevision: 0,
    installation: {
      id: installationId,
      clientName: input.clientName.trim(),
      siteName: input.siteName.trim(),
      siteAddress: input.siteAddress.trim(),
      inspectorName: input.inspectorName.trim(),
      auditDate: input.auditDate,
      siteCode: input.siteCode?.trim() || null,
      timezone: input.timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      externalKey: null,
      status: 'Draft',
      createdByUserId: user.id,
      assignedInspectorUserId: null,
      syncStatus: 'local',
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    },
    gridSupplies: [{
      id: `grid_${installationId}_primary`,
      installationId,
      name: 'Grid supply',
      isDefault: true,
    }],
    zones: [],
    electricalAssets: [],
    siteAssets: [],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    serverDerived: { virtualMeterDefinitions: [] },
  };
}

export function touchTree(tree: InstallationTree): InstallationTree {
  tree.installation.updatedAt = nowIso();
  tree.installation.syncStatus = 'local';
  return tree;
}

export function createZone(
  installationId: string,
  input: Pick<Zone, 'zoneName' | 'zoneDescription'>,
): Zone {
  const timestamp = nowIso();
  return {
    id: createId('zone'),
    installationId,
    zoneName: input.zoneName.trim(),
    zoneDescription: input.zoneDescription.trim(),
    photos: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function createBoard(
  installationId: string,
  zoneId: string,
): ElectricalAsset {
  const timestamp = nowIso();
  return {
    id: createId('board'),
    installationId,
    zoneId,
    assetName: '',
    displayCode: '',
    assetType: 'DB',
    typeCode: 'DB',
    customTypeName: null,
    electricalSource: { kind: 'TBC' },
    electricalParentId: null,
    electricalParentTbc: true,
    locationDescription: '',
    phase: '',
    amperageRating: '',
    siteNmi: '',
    photo: null,
    extraPhotos: [],
    meterPresent: false,
    meters: [],
    subCircuitsDescription: '',
    comments: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function createSiteAsset(
  installationId: string,
  zoneId: string,
): SiteAsset {
  const timestamp = nowIso();
  return {
    id: createId('site-asset'),
    installationId,
    zoneId,
    assetName: '',
    assetType: 'HVAC',
    typeCode: 'HVAC',
    customTypeName: null,
    electricalSource: { kind: 'TBC' },
    electricalBoardId: null,
    electricalBoardTbc: true,
    locationDescription: '',
    locationPhoto: null,
    displayCode: '',
    meterPresent: false,
    meteringState: { kind: 'TBC' },
    meterSwitchboardId: null,
    meterSwitchboardTbc: false,
    meterChannels: [],
    comments: '',
    extraPhotos: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function createMeter(): Meter {
  const id = createId('meter');
  return {
    id,
    deviceFamily: 'WATTWATCHERS',
    deviceName: 'A3RM Auditor',
    deviceNameOverridden: false,
    deviceType: 'A3RM',
    deviceId: '',
    deviceNumber: '',
    classification: '',
    coverage: '',
    wwPrestart: {},
    wwSwitchboard: {},
    wwChannels: Array.from({ length: 3 }, (_, index) => ({
      id: `${id}:${index + 1}`,
      ordinal: index + 1,
      purpose: 'SPARE',
    })),
    wwVerification: {},
    wwCommissioning: {},
    wwPhotos: { extra: [] },
  };
}

export type FormContext = {
  zoneId?: string | null;
  boardId?: string | null;
  meterId?: string | null;
  siteAssetId?: string | null;
};

export function allowedFormDefinitions(context: FormContext): FormDefinition[] {
  return FORM_DEFINITIONS.filter((definition) => {
    if (definition.availableForNew === false) return false;
    if (context.meterId) return definition.type === 'comms-fault';
    if (context.boardId) return ['ww-installation', 'ace-switchboard'].includes(definition.type);
    if (context.siteAssetId) {
      return ['honeywell-q400', 'captis-logger', 'sums-logger'].includes(definition.type);
    }
    return true;
  });
}

export function createFormSubmission(
  tree: InstallationTree,
  type: FormType,
  user: InstallHubUser,
  context: FormContext = {},
): FormSubmission {
  const timestamp = nowIso();
  const definition = FORM_DEFINITIONS.find((item) => item.type === type);
  if (!definition) throw new Error('Unknown Field App Complete form type.');
  const answers = createInitialFormAnswers(tree.installation, user);
  if (context.boardId) {
    const board = tree.electricalAssets.find((item) => item.id === context.boardId);
    if (board) {
      answers['auditor.switchboard_name'] = board.assetName;
      answers['auditor.switchboard_location'] = board.locationDescription ?? '';
      answers['auditor.switchboard_type'] = board.assetType;
      answers['auditor.site_nmi'] = board.siteNmi ?? '';
      answers['existing.switchboard_location'] = board.locationDescription ?? '';
      answers['existing.switchboard_type'] = board.assetType;
      answers['existing.site_nmi'] = board.siteNmi ?? '';
      const meter = context.meterId
        ? board.meters.find((item) => item.id === context.meterId)
        : undefined;
      if (meter) {
        answers['existing.device_id'] = meter.deviceId;
        answers['existing.device_number'] = meter.deviceNumber ?? '';
        answers['existing.device_type'] = meter.deviceType;
      }
    }
  }
  if (context.siteAssetId) {
    const asset = tree.siteAssets.find((item) => item.id === context.siteAssetId);
    if (asset) {
      answers['water.physical_location'] = asset.locationDescription ?? '';
      answers['captis.physical_location'] = asset.locationDescription ?? '';
      answers['captis.supply_description'] = asset.assetName;
    }
  }
  const supportedAnswerKeys = new Set(
    definition.sections.flatMap((section) =>
      section.fields
        .filter((field) => field.kind !== 'photo')
        .map((field) => field.key),
    ),
  );
  const supportedAnswers = Object.fromEntries(
    Object.entries(answers).filter(([key]) => supportedAnswerKeys.has(key)),
  );
  return {
    id: createId('form'),
    installationId: tree.installation.id,
    formType: type,
    schemaVersion: definition.schemaVersion,
    status: 'Draft',
    zoneId: context.zoneId ?? null,
    boardId: context.boardId ?? null,
    meterId: context.meterId ?? null,
    siteAssetId: context.siteAssetId ?? null,
    answers: supportedAnswers,
    attachments: [],
    completedAt: null,
    supersedesId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function createAmendment(source: FormSubmission): FormSubmission {
  const timestamp = nowIso();
  return {
    ...structuredClone(source),
    id: createId('form'),
    status: 'Draft',
    completedAt: null,
    supersedesId: source.id,
    // Match the iOS amendment workflow: retain the original cloud evidence
    // references so the installer only needs to replace evidence that changed.
    attachments: source.attachments.map((attachment) => ({
      ...attachment,
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function applyDraftFormSnapshot(
  tree: InstallationTree,
  formId: string,
  answers: Record<string, string>,
  attachments: FormAttachment[],
  updatedAt = nowIso(),
): FormSubmission | null {
  const target = tree.formSubmissions.find((item) => item.id === formId);
  if (!target || target.status === 'Completed') return null;
  target.answers = structuredClone(answers);
  target.attachments = structuredClone(attachments);
  target.updatedAt = updatedAt;
  return target;
}

export function syncOperationalMeter(
  tree: InstallationTree,
  completed: FormSubmission,
): void {
  if (!completed.boardId) return;
  const board = tree.electricalAssets.find((item) => item.id === completed.boardId);
  if (!board) return;
  if (completed.formType === 'comms-fault' && completed.meterId) {
    if (completed.answers['works.replace_device'] !== 'yes') return;
    board.meters = board.meters.map((meter) =>
      meter.id === completed.meterId
        ? meterAfterCommsReplacement(meter, completed.answers)
        : meter,
    );
    board.updatedAt = nowIso();
    return;
  }
  if (!['ww-installation', 'a3rm-installation', 'a6m-installation'].includes(completed.formType)) {
    return;
  }
  const deviceType =
    completed.formType === 'ww-installation'
      ? completed.answers['device.type'] as Meter['deviceType']
      : completed.formType === 'a3rm-installation'
        ? 'A3RM'
        : 'A6M';
  const deviceId = String(
    completed.answers[
      completed.formType === 'ww-installation' ? 'device.id' : 'auditor.serial_number'
    ] ?? '',
  );
  const meter: Meter = {
    id: completed.meterId ?? createId('meter'),
    deviceFamily: 'WATTWATCHERS',
    deviceName: `${deviceType} Auditor`,
    deviceNameOverridden: false,
    deviceType,
    deviceId,
    deviceNumber: String(completed.answers['device.number'] ?? ''),
    wwChannels: Array.from({ length: deviceType === 'A3RM' ? 3 : 6 }, (_, index) => ({
      id: `${completed.meterId ?? 'pending'}:${index + 1}`,
      ordinal: index + 1,
      purpose: ({
        'Main board supply': 'MAIN_SUPPLY',
        'Sub-circuit / asset': 'SUB_CIRCUIT',
        'Spare / unused': 'SPARE',
      } as Record<string, string>)[String(completed.answers[`channel.${index + 1}.purpose`] ?? '')]
        || (String(completed.answers[`channel.${index + 1}.load`] ?? '') === 'Not Used' ? 'SPARE' : 'SUB_CIRCUIT'),
      loadType: String(completed.answers[`channel.${index + 1}.load`] ?? ''),
      description: String(completed.answers[`channel.${index + 1}.description`] ?? ''),
      ...(deviceType === 'A3RM'
        ? { rogowskiSize: String(completed.answers[`channel.${index + 1}.rating`] ?? '') }
        : { ctRatio: String(completed.answers[`channel.${index + 1}.rating`] ?? '') }),
    })),
  };
  meter.wwChannels = meter.wwChannels?.map((channel, index) => ({
    ...channel,
    id: `${meter.id}:${index + 1}`,
  }));
  const existingIndex = board.meters.findIndex((item) => item.id === meter.id);
  if (existingIndex >= 0) board.meters[existingIndex] = { ...board.meters[existingIndex], ...meter };
  else board.meters.push(meter);
  board.meterPresent = true;
  board.updatedAt = nowIso();
  completed.meterId = meter.id;
}

export function removeZone(tree: InstallationTree, zoneId: string): void {
  const removedBoards = tree.electricalAssets.filter((item) => item.zoneId === zoneId);
  const boardIds = new Set(removedBoards.map((item) => item.id));
  const meterIds = new Set(
    removedBoards.flatMap((board) => board.meters.map((meter) => meter.id)),
  );
  const siteAssetIds = new Set(
    tree.siteAssets.filter((item) => item.zoneId === zoneId).map((item) => item.id),
  );
  tree.zones = tree.zones.filter((item) => item.id !== zoneId);
  tree.electricalAssets = tree.electricalAssets.filter((item) => item.zoneId !== zoneId);
  tree.siteAssets = tree.siteAssets.filter((item) => item.zoneId !== zoneId);
  tree.electricalAssets = tree.electricalAssets.map((board) => ({
    ...board,
    electricalParentId: boardIds.has(board.electricalParentId ?? '')
      ? null
      : board.electricalParentId,
    electricalParentTbc:
      board.electricalParentTbc ||
      boardIds.has(board.electricalParentId ?? ''),
  }));
  tree.siteAssets = tree.siteAssets.map((asset) => ({
    ...asset,
    electricalBoardId: boardIds.has(asset.electricalBoardId ?? '')
      ? null
      : asset.electricalBoardId,
    electricalBoardTbc:
      asset.electricalBoardTbc ||
      boardIds.has(asset.electricalBoardId ?? ''),
    meterSwitchboardId: boardIds.has(asset.meterSwitchboardId ?? '')
      ? null
      : asset.meterSwitchboardId,
    meterSwitchboardTbc:
      asset.meterSwitchboardTbc ||
      (asset.meterPresent && boardIds.has(asset.meterSwitchboardId ?? '')),
  }));
  tree.formSubmissions = tree.formSubmissions.filter(
    (form) =>
      form.zoneId !== zoneId &&
      !boardIds.has(form.boardId ?? '') &&
      !meterIds.has(form.meterId ?? '') &&
      !siteAssetIds.has(form.siteAssetId ?? ''),
  );
  touchTree(tree);
}

export type PhotoReference = {
  key: string;
  uri: string;
  label: string;
  entityType: 'zone' | 'electrical_asset' | 'site_asset' | 'form_submission';
  entityId: string;
};

export function collectPhotoReferences(tree: InstallationTree): PhotoReference[] {
  const references: PhotoReference[] = [];
  for (const zone of tree.zones) {
    zone.photos.forEach((uri, index) => references.push({
      key: `zone:${zone.id}:${index}`,
      uri,
      label: `${zone.zoneName} photo ${index + 1}`,
      entityType: 'zone',
      entityId: zone.id,
    }));
  }
  for (const board of tree.electricalAssets) {
    if (board.photo) references.push({
      key: `board:${board.id}:main`,
      uri: board.photo,
      label: `${board.assetName} main photo`,
      entityType: 'electrical_asset',
      entityId: board.id,
    });
    board.extraPhotos.forEach((uri, index) => references.push({
      key: `board:${board.id}:extra:${index}`,
      uri,
      label: `${board.assetName} extra photo ${index + 1}`,
      entityType: 'electrical_asset',
      entityId: board.id,
    }));
    for (const meter of board.meters) {
      const slots: Array<[string, string | null | undefined]> = [
        ['device installed', meter.wwPhotos?.deviceInstalled],
        ['switchboard overview', meter.wwPhotos?.switchboardOverview],
        ['labeling', meter.wwPhotos?.labeling],
      ];
      slots.forEach(([label, uri]) => {
        if (uri) references.push({
          key: `meter:${meter.id}:${label}`,
          uri,
          label: `${meter.deviceName} ${label}`,
          entityType: 'electrical_asset',
          entityId: board.id,
        });
      });
      meter.wwPhotos?.extra?.forEach((uri, index) => references.push({
        key: `meter:${meter.id}:extra:${index}`,
        uri,
        label: `${meter.deviceName} extra photo ${index + 1}`,
        entityType: 'electrical_asset',
        entityId: board.id,
      }));
    }
  }
  for (const asset of tree.siteAssets) {
    if (asset.locationPhoto) references.push({
      key: `asset:${asset.id}:location`,
      uri: asset.locationPhoto,
      label: `${asset.assetName} location photo`,
      entityType: 'site_asset',
      entityId: asset.id,
    });
    asset.extraPhotos.forEach((uri, index) => references.push({
      key: `asset:${asset.id}:extra:${index}`,
      uri,
      label: `${asset.assetName} extra photo ${index + 1}`,
      entityType: 'site_asset',
      entityId: asset.id,
    }));
  }
  for (const form of tree.formSubmissions) {
    form.attachments.forEach((attachment) => references.push({
      key: `form:${form.id}:${attachment.id}`,
      uri: attachment.uri,
      label: attachment.caption || attachment.slot,
      entityType: 'form_submission',
      entityId: form.id,
    }));
  }
  return references;
}

export function newFormAttachment(slot: string, uri: string, file: File): FormAttachment {
  return {
    id: createId('attachment'),
    slot,
    uri,
    mimeType: file.type || 'image/jpeg',
    caption: '',
    capturedAt: nowIso(),
  };
}
