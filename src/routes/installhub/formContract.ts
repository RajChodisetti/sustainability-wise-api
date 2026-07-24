import { badRequest } from '../../utils/errors.js';
import type { JsonRecord } from './helpers.js';

export const INSTALLHUB_FORM_TYPES = [
  'ww-installation',
  'a3rm-installation',
  'a6m-installation',
  'comms-fault',
  'ace-switchboard',
  'honeywell-q400',
  'captis-logger',
  'sums-logger',
] as const;

export type InstallHubSyncStage = 'metadata' | 'complete';
type CurrentInstallHubFormType =
  | 'ww-installation'
  | 'comms-fault'
  | 'ace-switchboard'
  | 'honeywell-q400'
  | 'captis-logger'
  | 'sums-logger';
type FieldKind = 'text' | 'number' | 'yesno' | 'select' | 'photo';

type Visibility = {
  key: string;
  equals: string | readonly string[];
};

export type InstallHubContractField = {
  key: string;
  kind: FieldKind;
  required?: boolean;
  options?: readonly string[];
  optionsWhen?: {
    key: string;
    values: Readonly<Record<string, readonly string[]>>;
  };
  showWhen?: Visibility | readonly Visibility[];
};

export type InstallHubContractSection = {
  fields: readonly InstallHubContractField[];
  showWhen?: Visibility | readonly Visibility[];
};

export type InstallHubContractDefinition = {
  type: CurrentInstallHubFormType;
  sections: readonly InstallHubContractSection[];
};

export type InstallHubFormAttachment = {
  id: string;
  slot: string;
  uri: string;
  mimeType: string;
  caption?: string | null;
  capturedAt: string;
};

const DEVICE_TYPES = ['A3RM', 'A6M'] as const;
const SENSOR_OPTIONS: Readonly<Record<(typeof DEVICE_TYPES)[number], readonly string[]>> = {
  A3RM: ['3000A - 9cm', '3000A - 20cm', '3000A - 29cm'],
  A6M: ['60A', '120A', '200A', '400A', '600A'],
};
const CHANNEL_LOADS = [
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
const USED_CHANNEL_LOADS = CHANNEL_LOADS.filter((load) => load !== 'Not Used');
const SIGNAL_OPTIONS = ['Excellent', 'Good', 'Fair', 'Poor', 'No signal', 'N/A'] as const;
const ANTENNA_OPTIONS = [
  'Internal',
  'CSM550 - External High Gain',
  'Other',
  'N/A',
] as const;

function text(key: string, required = false): InstallHubContractField {
  return { key, kind: 'text', required };
}

function number(key: string, required = false): InstallHubContractField {
  return { key, kind: 'number', required };
}

function yesNo(key: string, required = true): InstallHubContractField {
  return { key, kind: 'yesno', required };
}

function select(
  key: string,
  options: readonly string[],
  required = false,
): InstallHubContractField {
  return { key, kind: 'select', options, required };
}

function photo(
  key: string,
  required = true,
  showWhen?: Visibility | readonly Visibility[],
): InstallHubContractField {
  return { key, kind: 'photo', required, ...(showWhen ? { showWhen } : {}) };
}

function deviceType(
  key: string,
  showWhen?: Visibility | readonly Visibility[],
): InstallHubContractField {
  return {
    ...select(key, DEVICE_TYPES, true),
    ...(showWhen ? { showWhen } : {}),
  };
}

function sensor(
  key: string,
  deviceTypeKey: string,
  showWhen?: Visibility | readonly Visibility[],
): InstallHubContractField {
  return {
    key,
    kind: 'select',
    required: true,
    optionsWhen: {
      key: deviceTypeKey,
      values: SENSOR_OPTIONS,
    },
    ...(showWhen ? { showWhen } : {}),
  };
}

const siteFields: readonly InstallHubContractField[] = [
  text('site.date_time', true),
  text('site.customer_name', true),
  text('site.address', true),
  number('site.latitude'),
  number('site.longitude'),
];

const installerFields: readonly InstallHubContractField[] = [
  text('installer.name', true),
  text('installer.electrical_license'),
];

const prestartFields: readonly InstallHubContractField[] = [
  yesNo('prestart.site_inspection', false),
  yesNo('prestart.site_induction'),
  yesNo('prestart.safe_access'),
  yesNo('prestart.correct_ppe'),
  yesNo('prestart.live_points'),
  yesNo('prestart.can_isolate'),
  yesNo('prestart.additional_hazards'),
  {
    ...text('prestart.hazard_comments'),
    showWhen: { key: 'prestart.additional_hazards', equals: 'yes' },
  },
  yesNo('prestart.safe_to_proceed'),
];

function commonSections(): InstallHubContractSection[] {
  return [
    { fields: siteFields },
    { fields: installerFields },
    { fields: prestartFields },
  ];
}

function wwChannelSections(): InstallHubContractSection[] {
  return Array.from({ length: 6 }, (_, index) => {
    const channel = index + 1;
    const prefix = `channel.${channel}`;
    return {
      showWhen: {
        key: 'device.type',
        equals: channel <= 3 ? DEVICE_TYPES : 'A6M',
      },
      fields: [
        select(`${prefix}.load`, CHANNEL_LOADS, true),
        sensor(
          `${prefix}.rating`,
          'device.type',
          { key: `${prefix}.load`, equals: USED_CHANNEL_LOADS },
        ),
        {
          ...text(`${prefix}.description`),
          showWhen: { key: `${prefix}.load`, equals: USED_CHANNEL_LOADS },
        },
        photo(
          `${prefix}.nameplate_photos`,
          false,
          { key: `${prefix}.load`, equals: USED_CHANNEL_LOADS },
        ),
      ],
    };
  });
}

function wwCommissioningFields(): InstallHubContractField[] {
  const channelFields = Array.from({ length: 6 }, (_, index) => {
    const channel = index + 1;
    const conditions: Visibility[] = [
      { key: `channel.${channel}.load`, equals: USED_CHANNEL_LOADS },
    ];
    if (channel > 3) {
      conditions.unshift({ key: 'device.type', equals: 'A6M' });
    }
    return [
      {
        ...yesNo(`commissioning.channel_${channel}_polarity`, false),
        showWhen: conditions,
      },
      {
        ...number(`commissioning.channel_${channel}_current`),
        showWhen: conditions,
      },
    ];
  }).flat();
  return [
    yesNo('commissioning.energised'),
    yesNo('commissioning.leds_visible'),
    yesNo('commissioning.online'),
    select('commissioning.signal_strength', SIGNAL_OPTIONS, true),
    select('commissioning.antenna_type', ANTENNA_OPTIONS, true),
    yesNo('commissioning.start_complete'),
    photo('commissioning.start_screenshot'),
    yesNo('commissioning.channels_complete'),
    photo('commissioning.channels_screenshot'),
    number('commissioning.phase_a_voltage', true),
    number('commissioning.phase_b_voltage', true),
    number('commissioning.phase_c_voltage', true),
    ...channelFields,
    photo('commissioning.energy_screenshot'),
    photo('commissioning.completed_photos'),
    text('commissioning.final_comments'),
  ];
}

const wwInstallation: InstallHubContractDefinition = {
  type: 'ww-installation',
  sections: [
    ...commonSections(),
    {
      fields: [
        text('auditor.switchboard_name', true),
        text('auditor.switchboard_location', true),
        text('auditor.switchboard_type', true),
        text('auditor.site_nmi'),
        photo('auditor.location_before'),
        photo('auditor.sensor_before'),
        photo('auditor.cb_before'),
        deviceType('device.type'),
        text('device.number', true),
        text('device.id', true),
      ],
    },
    ...wwChannelSections(),
    {
      fields: [
        photo('auditor.installed_location'),
        photo('auditor.serial_photo'),
        photo('auditor.sensor_installed'),
        photo('auditor.cb_installed'),
      ],
    },
    { fields: wwCommissioningFields() },
  ],
};

const replacementVisible: Visibility = {
  key: 'works.replace_device',
  equals: 'yes',
};

const commsFault: InstallHubContractDefinition = {
  type: 'comms-fault',
  sections: [
    ...commonSections(),
    {
      fields: [
        text('existing.switchboard_location', true),
        text('existing.switchboard_type', true),
        text('existing.site_nmi'),
        photo('existing.switchboard_photos'),
        deviceType('existing.device_type'),
        text('existing.device_number', true),
        text('existing.device_id', true),
        sensor(
          'existing.sensor_rating',
          'existing.device_type',
          { key: 'existing.device_type', equals: DEVICE_TYPES },
        ),
        yesNo('existing.energised'),
        yesNo('existing.leds_visible'),
        yesNo('existing.online'),
        select('existing.signal', SIGNAL_OPTIONS),
        select('existing.antenna', ANTENNA_OPTIONS),
      ],
    },
    {
      fields: [
        yesNo('works.rebooted'),
        yesNo('works.leds_visible'),
        yesNo('works.replace_device'),
        deviceType('works.new_device_type', replacementVisible),
        { ...text('works.new_device_number', true), showWhen: replacementVisible },
        { ...text('works.new_device_id', true), showWhen: replacementVisible },
        sensor(
          'works.new_sensor_rating',
          'works.new_device_type',
          replacementVisible,
        ),
        { ...yesNo('works.new_online'), showWhen: replacementVisible },
        {
          ...select('works.new_signal', SIGNAL_OPTIONS),
          showWhen: replacementVisible,
        },
        yesNo('works.external_antenna'),
        {
          ...select('works.external_signal', SIGNAL_OPTIONS),
          showWhen: { key: 'works.external_antenna', equals: 'yes' },
        },
        yesNo('works.extend_antenna'),
        {
          ...select('works.extended_signal', SIGNAL_OPTIONS),
          showWhen: { key: 'works.extend_antenna', equals: 'yes' },
        },
      ],
    },
    {
      fields: [
        {
          ...yesNo('commissioning.onboarding_complete'),
          showWhen: replacementVisible,
        },
        {
          ...yesNo('commissioning.details_same'),
          showWhen: replacementVisible,
        },
        photo('commissioning.start_screenshot', true, replacementVisible),
        photo('commissioning.energy_screenshot', true, replacementVisible),
        photo('commissioning.completed_photos'),
        text('commissioning.final_comments'),
      ],
    },
  ],
};

const aceSwitchboard: InstallHubContractDefinition = {
  type: 'ace-switchboard',
  sections: [
    {
      fields: [
        text('site.date_time', true),
        text('job.name', true),
        text('job.number', true),
        text('job.qr_link'),
      ],
    },
    {
      fields: [...installerFields, text('installer.rec_number')],
    },
    {
      fields: [
        yesNo('install.ct_installed'),
        yesNo('install.ct_orientation'),
        text('install.ct_ratio', true),
        text('install.ct_serial_a', true),
        text('install.ct_serial_b', true),
        text('install.ct_serial_c', true),
        photo('install.ct_chamber_photo'),
        yesNo('install.test_block'),
        yesNo('install.remove_star_point'),
        yesNo('install.star_point_removed'),
        yesNo('install.ct_fuses'),
        text('install.ct_fuse_rating'),
        yesNo('install.secondary_fuses'),
        text('install.secondary_fuse_rating'),
        photo('install.meter_panel_photo'),
        yesNo('install.loom_installed'),
        text('install.loom_type'),
        text('install.loom_size'),
        yesNo('install.wiring_complete'),
        photo('install.ct_wiring_photo'),
        photo('install.panel_wiring_photo'),
      ],
    },
    {
      fields: [
        yesNo('precommission.test_meter'),
        yesNo('precommission.point_to_point'),
        yesNo('precommission.load_box'),
        yesNo('precommission.safe_energise'),
        yesNo('precommission.correct_ppe'),
        yesNo('precommission.energised'),
        yesNo('precommission.ct_ratio_set'),
      ],
    },
    {
      fields: [
        ...['a', 'b', 'c'].flatMap((phase) => [
          number(`testing.phase_${phase}_voltage`, true),
          number(`testing.phase_${phase}_primary_current`, true),
          number(`testing.phase_${phase}_secondary_current`, true),
        ]),
        photo('testing.status_screen'),
        photo('testing.phasor_diagram'),
      ],
    },
    {
      fields: [
        yesNo('final.deenergised'),
        yesNo('final.load_box_removed'),
        yesNo('final.test_meter_removed'),
        yesNo('final.connectors_installed'),
        yesNo('final.connections_checked'),
        yesNo('final.completed'),
        photo('final.completed_photo'),
      ],
    },
  ],
};

const honeywellQ400: InstallHubContractDefinition = {
  type: 'honeywell-q400',
  sections: [
    {
      fields: [
        ...siteFields,
        text('water.physical_location', true),
      ],
    },
    { fields: installerFields.slice(0, 1) },
    {
      fields: [
        text('water.serial_number', true),
        yesNo('water.activated'),
        yesNo('water.network_registered'),
        photo('water.lcd_photo'),
        photo('water.completed_photo'),
      ],
    },
  ],
};

function loggerDefinition(
  type: 'captis-logger' | 'sums-logger',
): InstallHubContractDefinition {
  return {
    type,
    sections: [
      {
        fields: [
          ...siteFields,
          text('captis.physical_location', true),
          text('captis.supply_description', true),
        ],
      },
      { fields: installerFields.slice(0, 1) },
      {
        fields: [
          text('meter.type', true),
          text('meter.make', true),
          text('meter.model', true),
          text('meter.serial_number', true),
          text('meter.sensor_type', true),
          text('meter.flow_rate', true),
          text('meter.current_read', true),
          photo('meter.face_photo'),
        ],
      },
      {
        fields: [
          text('logger.serial_number', true),
          number('logger.rsrp', true),
          yesNo('logger.external_antenna'),
          yesNo('logger.cumulocity_configured'),
          yesNo('logger.screenshot_taken'),
          photo('logger.cumulocity_screenshot'),
        ],
      },
    ],
  };
}

export const INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS: Readonly<
  Record<CurrentInstallHubFormType, InstallHubContractDefinition>
> = {
  'ww-installation': wwInstallation,
  'comms-fault': commsFault,
  'ace-switchboard': aceSwitchboard,
  'honeywell-q400': honeywellQ400,
  'captis-logger': loggerDefinition('captis-logger'),
  'sums-logger': loggerDefinition('sums-logger'),
};

function answer(answers: Record<string, string>, key: string): string {
  return answers[key]?.trim() ?? '';
}

function conditionsMatch(
  conditions: Visibility | readonly Visibility[] | undefined,
  answers: Record<string, string>,
): boolean {
  if (!conditions) return true;
  const list = Array.isArray(conditions) ? conditions : [conditions];
  return list.every((condition) => {
    const expected = Array.isArray(condition.equals)
      ? condition.equals
      : [condition.equals];
    return expected.includes(answer(answers, condition.key));
  });
}

function optionsForField(
  field: InstallHubContractField,
  answers: Record<string, string>,
): readonly string[] {
  if (field.optionsWhen) {
    return field.optionsWhen.values[answer(answers, field.optionsWhen.key)] ?? [];
  }
  return field.options ?? [];
}

function validateRemoteUri(uri: string, index: number): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw badRequest(`attachments[${index}].uri must be a remote HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw badRequest(`attachments[${index}].uri must be a remote HTTP(S) URL`);
  }
}

function validateAttachments(value: unknown): InstallHubFormAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest('attachments must be an array');
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw badRequest(`attachments[${index}] must be an object`);
    }
    const record = item as JsonRecord;
    const requiredAttachmentString = (key: string): string => {
      const fieldValue = record[key];
      if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
        throw badRequest(`attachments[${index}].${key} is required`);
      }
      return fieldValue.trim();
    };
    const id = requiredAttachmentString('id');
    if (ids.has(id)) throw badRequest(`Duplicate attachment id: ${id}`);
    ids.add(id);
    const slot = requiredAttachmentString('slot');
    const uri = requiredAttachmentString('uri');
    validateRemoteUri(uri, index);
    const mimeType = requiredAttachmentString('mimeType');
    if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
      throw badRequest(`attachments[${index}].mimeType must be an image MIME type`);
    }
    const capturedAt = requiredAttachmentString('capturedAt');
    if (Number.isNaN(new Date(capturedAt).getTime())) {
      throw badRequest(`attachments[${index}].capturedAt must be an ISO date`);
    }
    if (
      record.caption !== undefined
      && record.caption !== null
      && typeof record.caption !== 'string'
    ) {
      throw badRequest(`attachments[${index}].caption must be a string or null`);
    }
    return {
      id,
      slot,
      uri,
      mimeType,
      capturedAt,
      ...(record.caption === null || typeof record.caption === 'string'
        ? { caption: record.caption }
        : {}),
    };
  });
}

function validateFieldAnswer(
  field: InstallHubContractField,
  answers: Record<string, string>,
  completed: boolean,
): void {
  const value = answer(answers, field.key);
  if (field.kind === 'photo') {
    if (value) throw badRequest(`answers.${field.key} must not contain photo data`);
    return;
  }
  if (!value) {
    if (completed && field.required) {
      throw badRequest(`Completed form requires answers.${field.key}`);
    }
    return;
  }
  if (field.kind === 'yesno' && !['yes', 'no'].includes(value)) {
    throw badRequest(`answers.${field.key} must be yes or no`);
  }
  if (field.kind === 'number' && !Number.isFinite(Number(value))) {
    throw badRequest(`answers.${field.key} must be a number`);
  }
  if (field.kind === 'select' && !optionsForField(field, answers).includes(value)) {
    throw badRequest(`answers.${field.key} is not a valid selection`);
  }
}

function validateSchemaV2Definition(input: {
  definition: InstallHubContractDefinition;
  status: string;
  answers: Record<string, string>;
  attachments: InstallHubFormAttachment[];
  syncStage?: InstallHubSyncStage;
}): void {
  const completed = input.status === 'Completed';
  const requireCompletedEvidence = completed && input.syncStage !== 'metadata';
  const attachmentsBySlot = new Map<string, InstallHubFormAttachment[]>();
  for (const attachment of input.attachments) {
    const list = attachmentsBySlot.get(attachment.slot) ?? [];
    list.push(attachment);
    attachmentsBySlot.set(attachment.slot, list);
  }

  const knownAnswerKeys = new Set<string>();
  const knownPhotoSlots = new Set<string>();
  const visiblePhotoSlots = new Set<string>();

  for (const section of input.definition.sections) {
    const sectionVisible = conditionsMatch(section.showWhen, input.answers);
    for (const field of section.fields) {
      if (field.kind === 'photo') knownPhotoSlots.add(field.key);
      else knownAnswerKeys.add(field.key);
      const visible = sectionVisible && conditionsMatch(field.showWhen, input.answers);
      if (!visible) {
        if (answer(input.answers, field.key)) {
          throw badRequest(`answers.${field.key} must be empty while the field is hidden`);
        }
        if ((attachmentsBySlot.get(field.key)?.length ?? 0) > 0) {
          throw badRequest(`attachments slot ${field.key} must be empty while the field is hidden`);
        }
        continue;
      }
      if (field.kind === 'photo') {
        visiblePhotoSlots.add(field.key);
        if (
          requireCompletedEvidence
          && field.required
          && (attachmentsBySlot.get(field.key)?.length ?? 0) === 0
        ) {
          throw badRequest(`Completed form requires attachments slot ${field.key}`);
        }
      }
      validateFieldAnswer(field, input.answers, completed);
    }
  }

  for (const key of Object.keys(input.answers)) {
    if (!knownAnswerKeys.has(key)) {
      if (knownPhotoSlots.has(key)) {
        throw badRequest(`answers.${key} must not contain photo data`);
      }
      throw badRequest(`answers.${key} is not supported for ${input.definition.type}`);
    }
  }
  for (const slot of attachmentsBySlot.keys()) {
    if (!knownPhotoSlots.has(slot)) {
      throw badRequest(`attachments slot ${slot} is not supported for ${input.definition.type}`);
    }
    if (!visiblePhotoSlots.has(slot)) {
      throw badRequest(`attachments slot ${slot} must be empty while the field is hidden`);
    }
  }
}

export function validateInstallHubFormContract(input: {
  formType: string;
  schemaVersion: number;
  status: string;
  answers: JsonRecord;
  attachments?: unknown;
  syncStage?: InstallHubSyncStage;
}): void {
  if (!INSTALLHUB_FORM_TYPES.includes(
    input.formType as (typeof INSTALLHUB_FORM_TYPES)[number],
  )) {
    throw badRequest(`Unsupported InstallHub formType: ${input.formType}`);
  }
  if (![1, 2].includes(input.schemaVersion)) {
    throw badRequest(`Unsupported InstallHub schemaVersion: ${input.schemaVersion}`);
  }
  if (!['Draft', 'Completed'].includes(input.status)) {
    throw badRequest('InstallHub form status must be Draft or Completed');
  }
  if (
    (input.formType === 'ww-installation' || input.formType === 'sums-logger')
    && input.schemaVersion < 2
  ) {
    throw badRequest(`${input.formType} requires schemaVersion 2 or later`);
  }
  for (const [key, value] of Object.entries(input.answers)) {
    if (typeof value !== 'string') {
      throw badRequest(`answers.${key} must be a string`);
    }
  }

  // Existing schema-v1 records remain readable and syncable as-is. The exact
  // field/evidence contract starts at schema v2.
  if (input.schemaVersion === 1) return;

  const definition = INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS[
    input.formType as CurrentInstallHubFormType
  ];
  if (!definition) {
    throw badRequest(`${input.formType} does not support schemaVersion 2`);
  }
  validateSchemaV2Definition({
    definition,
    status: input.status,
    answers: input.answers as Record<string, string>,
    attachments: validateAttachments(input.attachments),
    syncStage: input.syncStage,
  });
}
