import {
  FORM_DEFINITIONS,
  createInitialFormAnswers,
  isFieldVisible,
  isSectionVisible,
  meterAfterCommsReplacement,
  operationalMeterForCompletedForm,
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
import { defaultMeterCustomName } from '@/modules/installhub/lib/naming';

export function createId(prefix: string): string {
  return createInstallHubId(prefix);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return nowIso().slice(0, 10);
}

export const INSTALLATION_SITE_CODE_MAX_LENGTH = 16;
export const INSTALLATION_SITE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function isValidInstallationSiteCode(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized.length >= 1
    && normalized.length <= INSTALLATION_SITE_CODE_MAX_LENGTH
    && INSTALLATION_SITE_CODE_PATTERN.test(normalized);
}

export function canonicalSiteCode(siteName: string, explicit?: string | null): string {
  const supplied = explicit?.trim();
  if (supplied) {
    const normalized = supplied.toUpperCase();
    if (!isValidInstallationSiteCode(normalized)) {
      throw new Error(
        'Site code must be 1-16 letters/digits, with single hyphens only between groups.',
      );
    }
    return normalized;
  }
  return siteName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 8)
    .toUpperCase() || 'SITE';
}

/** Preserve an existing authoritative code byte-for-byte unless the user
 * deliberately changes it. Historical installations may predate the current
 * bounded contract and must remain editable without silently renaming all
 * established display-code identity. */
export function canonicalSiteCodeForWrite(
  siteName: string,
  explicit: string | null | undefined,
  authoritativeSiteCode?: string | null,
): string {
  if (
    typeof authoritativeSiteCode === 'string'
    && authoritativeSiteCode.trim()
    && explicit === authoritativeSiteCode
  ) return authoritativeSiteCode;
  return canonicalSiteCode(siteName, explicit);
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
  const siteName = input.siteName.trim() || 'Untitled installation';
  return {
    treeSchemaVersion: 2,
    baseTreeRevision: 0,
    treeRevision: 0,
    recordVersionNumber: 0,
    installation: {
      id: installationId,
      treeSchemaVersion: 2,
      treeRevision: 0,
      recordVersionNumber: 0,
      clientName: input.clientName.trim(),
      siteName,
      siteAddress: input.siteAddress.trim(),
      inspectorName: input.inspectorName.trim(),
      auditDate: input.auditDate || todayIso(),
      siteCode: canonicalSiteCode(siteName, input.siteCode),
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
      name: 'Incoming grid connection',
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

/** Reuses the exact first-create snapshot until the server has acknowledged it. */
export function installationCreateAttempt(
  pending: InstallationTree | null,
  input: Parameters<typeof createInstallationTree>[0],
  user: InstallHubUser,
): InstallationTree {
  return pending ?? createInstallationTree(input, user);
}

export type InstallationCreateFailureDisposition = 'RETAIN' | 'RECONCILE';

/**
 * Network, timeout, and server failures are ambiguous. A conflict must be
 * reconciled by installation ID because the first request may have committed
 * and then changed. Every other automatic failure retains the exact request:
 * a later rejection cannot prove an earlier invocation did not commit.
 */
export function installationCreateFailureDisposition(
  status: number | null | undefined,
): InstallationCreateFailureDisposition {
  if (status === 409) return 'RECONCILE';
  return 'RETAIN';
}

type InstallationCreateAttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type InstallationCreateAttemptEnvelope = {
  version: 1;
  ownerUserId: string;
  tree: InstallationTree;
};

export const INSTALLATION_CREATE_ATTEMPT_SESSION_KEY =
  'installhub:new-installation:create-attempt:v1';

export function installationCreateAttemptSessionKey(ownerUserId: string): string {
  return `${INSTALLATION_CREATE_ATTEMPT_SESSION_KEY}:${encodeURIComponent(ownerUserId)}`;
}

function defaultCreateAttemptStorage(): InstallationCreateAttemptStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRestorableInstallationCreateAttempt(
  value: unknown,
  ownerUserId: string,
): value is InstallationCreateAttemptEnvelope {
  if (!isRecord(value) || value.version !== 1 || value.ownerUserId !== ownerUserId) return false;
  const tree = value.tree;
  if (!isRecord(tree) || !isRecord(tree.installation) || !isRecord(tree.serverDerived)) return false;
  const installation = tree.installation;
  const emptyCollections = [
    tree.zones,
    tree.electricalAssets,
    tree.siteAssets,
    tree.meterDevices,
    tree.measurementAssignments,
    tree.formSubmissions,
    tree.serverDerived.virtualMeterDefinitions,
  ];
  if (!emptyCollections.every((items) => Array.isArray(items) && items.length === 0)) return false;
  if (!Array.isArray(tree.gridSupplies) || tree.gridSupplies.length !== 1) return false;
  const gridSupply = tree.gridSupplies[0];
  if (!isRecord(gridSupply)) return false;
  const requiredText = [
    installation.id,
    installation.siteName,
    installation.auditDate,
    installation.siteCode,
    installation.timezone,
    installation.createdAt,
    installation.updatedAt,
    gridSupply.id,
    gridSupply.name,
  ];
  return requiredText.every((item) => typeof item === 'string' && item.length > 0)
    && tree.treeSchemaVersion === 2
    && tree.baseTreeRevision === 0
    && tree.treeRevision === 0
    && tree.recordVersionNumber === 0
    && installation.treeSchemaVersion === 2
    && installation.treeRevision === 0
    && installation.recordVersionNumber === 0
    && installation.externalKey === null
    && installation.status === 'Draft'
    && installation.createdByUserId === ownerUserId
    && installation.syncStatus === 'local'
    && installation.deletedAt === null
    && gridSupply.installationId === installation.id
    && gridSupply.isDefault === true;
}

/** Stores the exact non-media first-create snapshot in this browser tab before POST. */
export function persistInstallationCreateAttempt(
  tree: InstallationTree,
  ownerUserId: string,
  storage: InstallationCreateAttemptStorage | null = defaultCreateAttemptStorage(),
): boolean {
  if (!storage) return false;
  const envelope: InstallationCreateAttemptEnvelope = { version: 1, ownerUserId, tree };
  if (!isRestorableInstallationCreateAttempt(envelope, ownerUserId)) return false;
  try {
    storage.setItem(installationCreateAttemptSessionKey(ownerUserId), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** Restores only a valid first-create snapshot owned by the signed-in user. */
export function restoreInstallationCreateAttempt(
  ownerUserId: string,
  storage: InstallationCreateAttemptStorage | null = defaultCreateAttemptStorage(),
): InstallationTree | null {
  if (!storage) return null;
  try {
    const storageKey = installationCreateAttemptSessionKey(ownerUserId);
    const encoded = storage.getItem(storageKey);
    if (!encoded) return null;
    const envelope: unknown = JSON.parse(encoded);
    if (!isRestorableInstallationCreateAttempt(envelope, ownerUserId)) {
      storage.removeItem(storageKey);
      return null;
    }
    return envelope.tree;
  } catch {
    try {
      storage.removeItem(installationCreateAttemptSessionKey(ownerUserId));
    } catch {
      // Storage may be unavailable; there is no safe recovery action to take.
    }
    return null;
  }
}

export function clearInstallationCreateAttempt(
  ownerUserId: string,
  expectedInstallationId?: string,
  storage: InstallationCreateAttemptStorage | null = defaultCreateAttemptStorage(),
): boolean {
  if (!storage) return false;
  try {
    const storageKey = installationCreateAttemptSessionKey(ownerUserId);
    if (expectedInstallationId) {
      const encoded = storage.getItem(storageKey);
      if (!encoded) return true;
      const envelope: unknown = JSON.parse(encoded);
      if (
        isRestorableInstallationCreateAttempt(envelope, ownerUserId)
        && envelope.tree.installation.id !== expectedInstallationId
      ) return false;
    }
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export function touchTree(tree: InstallationTree): InstallationTree {
  tree.installation.updatedAt = nowIso();
  tree.installation.syncStatus = 'local';
  return tree;
}

export function createZone(
  installationId: string,
  input: Pick<Zone, 'zoneName' | 'zoneDescription'> & Partial<Pick<Zone, 'zoneCode'>>,
): Zone {
  const timestamp = nowIso();
  return {
    id: createId('zone'),
    installationId,
    ...(input.zoneCode ? { zoneCode: input.zoneCode.trim().toUpperCase() } : {}),
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
    assetName: 'Distribution board',
    displayCode: '',
    assetType: 'DB',
    typeCode: 'DB',
    customTypeName: null,
    electricalSource: { kind: 'TBC' },
    electricalParentId: null,
    electricalParentTbc: true,
    locationDescription: '',
    phase: null,
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
    assetName: 'AC / HVAC',
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
    customName: 'A3RM Meter',
    deviceName: 'A3RM Meter',
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

const WW_CHANNEL_PURPOSE_LABELS: Record<string, string> = {
  MAIN_SUPPLY: 'Main board supply',
  SUB_CIRCUIT: 'Sub-circuit / asset',
  SPARE: 'Spare / unused',
};

const WW_LOAD_LABELS = new Set([
  'Mains Supply',
  'HVAC',
  'Lighting',
  'Solar PV',
  'Forklift Charger',
  'Hot Water',
  'General Power',
  'Other',
  'Not Used',
]);

const WW_LOAD_LABEL_BY_CODE: Record<string, string> = {
  HVAC: 'HVAC',
  LIGHTING: 'Lighting',
  PV: 'Solar PV',
  FORKLIFT: 'Forklift Charger',
  HEATER_GEYSER: 'Hot Water',
  POWER_OUTLET: 'General Power',
  OTHER: 'Other',
  EV_CHARGER: 'Other',
  VEHICLE_HOIST: 'Other',
  EXHAUST_FAN_SYSTEM: 'Other',
  REFRIGERATION: 'Other',
  COMPRESSED_AIR: 'Other',
};

const WW_CUSTOM_LOAD_LABEL_BY_CODE: Record<string, string> = {
  EV_CHARGER: 'EV Charger',
  VEHICLE_HOIST: 'Vehicle Hoist',
  EXHAUST_FAN_SYSTEM: 'Exhaust / Fan System',
  REFRIGERATION: 'Refrigeration',
  COMPRESSED_AIR: 'Compressed Air',
};

function prefillWwInstallationAnswers(
  answers: Record<string, string>,
  meter: Meter,
): void {
  if (meter.deviceType !== 'A3RM' && meter.deviceType !== 'A6M') return;
  answers['device.type'] = meter.deviceType;
  answers['device.name'] = meter.customName?.trim()
    || defaultMeterCustomName({
      deviceModel: meter.deviceType,
      customManufacturerName: meter.customManufacturerName,
      customModelName: meter.customModelName,
    });
  answers['device.id'] = meter.deviceId;
  answers['device.number'] = meter.deviceNumber ?? '';

  const channelCount = meter.deviceType === 'A3RM' ? 3 : 6;
  const channels = (meter.wwChannels ?? [])
    .map((channel, index) => ({ channel, ordinal: channel.ordinal ?? index + 1 }))
    .sort((left, right) => left.ordinal - right.ordinal);
  const seenOrdinals = new Set<number>();
  for (const { channel, ordinal } of channels) {
    if (ordinal < 1 || ordinal > channelCount || seenOrdinals.has(ordinal)) continue;
    seenOrdinals.add(ordinal);
    const rawLoad = channel.loadType?.trim() ?? '';
    const inferredPurpose = rawLoad === 'Mains Supply'
      ? 'Main board supply'
      : rawLoad === 'Not Used'
        ? 'Spare / unused'
        : 'Sub-circuit / asset';
    const purpose = WW_CHANNEL_PURPOSE_LABELS[channel.purpose ?? ''] ?? inferredPurpose;
    answers[`channel.${ordinal}.purpose`] = purpose;
    if (purpose === 'Spare / unused') continue;

    const canonicalLoad = purpose === 'Main board supply'
      ? 'Mains Supply'
      : WW_LOAD_LABELS.has(rawLoad)
        ? rawLoad
        : WW_LOAD_LABEL_BY_CODE[rawLoad]
          ?? (rawLoad ? 'Other' : '');
    if (canonicalLoad) answers[`channel.${ordinal}.load`] = canonicalLoad;
    if (canonicalLoad === 'Other') {
      const customLoad = channel.customLoadTypeName?.trim()
        || WW_CUSTOM_LOAD_LABEL_BY_CODE[rawLoad]
        || (rawLoad && rawLoad !== 'Other' && rawLoad !== 'OTHER' ? rawLoad : '');
      if (customLoad) answers[`channel.${ordinal}.custom_load_type`] = customLoad;
    }
    const rating = channel.rogowskiSize?.trim() || channel.ctRatio?.trim();
    if (rating) answers[`channel.${ordinal}.rating`] = rating;
    if (channel.description?.trim()) {
      answers[`channel.${ordinal}.description`] = channel.description.trim();
    }
  }
}

export function allowedFormDefinitions(context: FormContext): FormDefinition[] {
  return FORM_DEFINITIONS.filter((definition) => {
    if (definition.availableForNew === false) return false;
    if (context.meterId) {
      // A meter detail can start a comms-fault record. Reconciliation links
      // carry both board and meter IDs so the optional WW installation form
      // can also retain the exact stable meter relationship.
      return context.boardId
        ? ['ww-installation', 'comms-fault'].includes(definition.type)
        : definition.type === 'comms-fault';
    }
    if (context.boardId) return ['ww-installation', 'ace-switchboard'].includes(definition.type);
    if (context.siteAssetId) {
      return ['honeywell-q400', 'captis-logger', 'sums-logger'].includes(definition.type);
    }
    // A comms record represents work on a known installed device. Keep it out
    // of the general form picker so the replacement workflow always retains
    // the exact device, switchboard, and zone context.
    return definition.type !== 'comms-fault';
  });
}

/**
 * Form context is optional capture metadata. Clear stale references before a
 * write so referential integrity stays intact without turning context into a
 * mandatory completion field.
 */
export function normalizeOptionalFormContext(
  tree: InstallationTree,
  form: FormSubmission,
): FormSubmission {
  if (form.zoneId && !tree.zones.some((item) => item.id === form.zoneId)) {
    form.zoneId = null;
  }
  if (form.boardId && !tree.electricalAssets.some((item) => item.id === form.boardId)) {
    form.boardId = null;
  }
  if (form.siteAssetId && !tree.siteAssets.some((item) => item.id === form.siteAssetId)) {
    form.siteAssetId = null;
  }
  if (form.meterId) {
    const canonicalMeter = (tree.meterDevices || []).find((item) => item.id === form.meterId);
    const legacyBoard = tree.electricalAssets.find((board) => (
      board.meters.some((item) => item.id === form.meterId)
    ));
    const installedOnBoardId = canonicalMeter?.installedOnBoardId ?? legacyBoard?.id;
    if (!installedOnBoardId || (form.boardId && installedOnBoardId !== form.boardId)) {
      form.meterId = null;
    }
  }
  return form;
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
  if (type === 'ww-installation') {
    answers['device.type'] = 'A3RM';
    answers['device.name'] = defaultMeterCustomName({ deviceModel: 'A3RM' });
  }
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
        if (type === 'ww-installation') prefillWwInstallationAnswers(answers, meter);
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
  const definition = FORM_DEFINITIONS.find((item) => item.type === source.formType);
  const supportedAnswerKeys = new Set(
    definition?.sections.flatMap((section) => section.fields
      .filter((field) => field.kind !== 'photo')
      .map((field) => field.key)) || [],
  );
  const answers = definition
    ? Object.fromEntries(
        Object.entries(source.answers).filter(([key]) => supportedAnswerKeys.has(key)),
      )
    : structuredClone(source.answers);
  if (definition) {
    let removedHiddenAnswer = true;
    while (removedHiddenAnswer) {
      removedHiddenAnswer = false;
      for (const section of definition.sections) {
        const sectionVisible = isSectionVisible(section, answers);
        for (const field of section.fields) {
          if (
            field.kind !== 'photo'
            && field.key in answers
            && (!sectionVisible || !isFieldVisible(field, answers))
          ) {
            delete answers[field.key];
            removedHiddenAnswer = true;
          }
        }
      }
    }
  }
  const visiblePhotoSlots = new Set(
    definition?.sections.flatMap((section) => (
      isSectionVisible(section, answers)
        ? section.fields
          .filter((field) => field.kind === 'photo' && isFieldVisible(field, answers))
          .map((field) => field.key)
        : []
    )) || [],
  );
  return {
    ...structuredClone(source),
    id: createId('form'),
    status: 'Draft',
    completedAt: null,
    supersedesId: source.id,
    answers,
    // Match the iOS amendment workflow: retain the original cloud evidence
    // references that remain valid and visible under the selected form contract.
    // Obsolete or hidden slots stay preserved on the immutable source record.
    attachments: source.attachments
      .filter((attachment) => !definition || visiblePhotoSlots.has(attachment.slot))
      .map((attachment) => ({
        ...attachment,
      })),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function deleteDraftForm(
  tree: InstallationTree,
  formId: string,
): FormSubmission {
  const target = tree.formSubmissions.find((item) => item.id === formId);
  if (!target) throw new Error('Form not found.');
  if (target.status !== 'Draft') {
    throw new Error('Completed forms are immutable and cannot be deleted.');
  }
  if (tree.formSubmissions.some((item) => item.supersedesId === formId)) {
    throw new Error(
      'This draft cannot be deleted while a later amendment refers to it.',
    );
  }
  tree.formSubmissions = tree.formSubmissions.filter(
    (item) => item.id !== formId,
  );
  return target;
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
  const meter: Meter | null = completed.formType === 'ww-installation'
    ? operationalMeterForCompletedForm(
        completed,
        completed.meterId
          ? board.meters.find((item) => item.id === completed.meterId)
          : undefined,
      )
    : (() => {
        const deviceType = completed.formType === 'a3rm-installation' ? 'A3RM' : 'A6M';
        const id = completed.meterId ?? createId('meter');
        return {
          id,
          deviceFamily: 'WATTWATCHERS' as const,
          customName: defaultMeterCustomName({ deviceModel: deviceType }),
          deviceName: defaultMeterCustomName({ deviceModel: deviceType }),
          deviceNameOverridden: false,
          deviceType,
          deviceId: String(completed.answers['auditor.serial_number'] ?? ''),
          deviceNumber: String(completed.answers['device.number'] ?? ''),
          wwChannels: Array.from({ length: deviceType === 'A3RM' ? 3 : 6 }, (_, index) => ({
            id: `${id}:${index + 1}`,
            ordinal: index + 1,
            purpose: String(completed.answers[`channel.${index + 1}.load`] ?? '') === 'Not Used'
              ? 'SPARE'
              : 'SUB_CIRCUIT',
            loadType: String(completed.answers[`channel.${index + 1}.load`] ?? ''),
            description: String(completed.answers[`channel.${index + 1}.description`] ?? ''),
            ...(deviceType === 'A3RM'
              ? { rogowskiSize: String(completed.answers[`channel.${index + 1}.rating`] ?? '') }
              : { ctRatio: String(completed.answers[`channel.${index + 1}.rating`] ?? '') }),
          })),
        } satisfies Meter;
      })();
  if (!meter) return;
  const existingIndex = board.meters.findIndex((item) => item.id === meter.id);
  const existingMeter = existingIndex >= 0 ? board.meters[existingIndex] : undefined;
  const existingChannels = new Map(
    (existingMeter?.wwChannels ?? []).map((channel, index) => [
      channel.ordinal ?? index + 1,
      channel,
    ]),
  );
  meter.wwChannels = meter.wwChannels?.map((channel, index) => {
    const ordinal = channel.ordinal ?? index + 1;
    const prior = existingChannels.get(ordinal);
    return {
      ...prior,
      ...channel,
      id: prior?.id ?? channel.id ?? `${meter.id}:${ordinal}`,
      ordinal,
      loadType: channel.loadType,
      customLoadTypeName: channel.customLoadTypeName,
      rogowskiSize: channel.rogowskiSize,
      ctRatio: channel.ctRatio,
      description: channel.description,
    };
  });
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
