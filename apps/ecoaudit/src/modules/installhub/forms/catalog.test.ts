import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type {
  FormSubmission,
  Meter,
} from '@/modules/installhub/types/domain';
import {
  ANTENNAS,
  FORM_DEFINITION_BY_TYPE,
  FORM_DEFINITIONS,
  SENSOR_OPTIONS_BY_DEVICE,
  SIGNALS,
  SWITCHBOARD_TYPES,
  acceptedOptionsForField,
  answersAfterChange,
  editorOptionsForField,
  formValidationIssues,
  isFieldVisible,
  isSectionVisible,
  meterAfterCommsReplacement,
  optionsForField,
  validateForm,
} from './catalog';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function submission(
  formType: FormSubmission['formType'],
  answers: FormSubmission['answers'],
): FormSubmission {
  return {
    id: 'form-test',
    installationId: 'installation-1',
    formType,
    schemaVersion: 2,
    status: 'Draft',
    answers,
    attachments: [],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

test('new-form catalog matches the six Field App Complete iOS form families', () => {
  assert.deepEqual(
    FORM_DEFINITIONS
      .filter((definition) => definition.availableForNew !== false)
      .map((definition) => definition.type),
    [
      'ww-installation',
      'comms-fault',
      'ace-switchboard',
      'honeywell-q400',
      'captis-logger',
      'sums-logger',
    ],
  );
  assert.equal(
    FORM_DEFINITION_BY_TYPE['a3rm-installation'].availableForNew,
    false,
  );
  assert.equal(
    FORM_DEFINITION_BY_TYPE['a6m-installation'].availableForNew,
    false,
  );
  assert.ok(
    FORM_DEFINITION_BY_TYPE['a3rm-installation'].sections.some(
      (section) => section.title === 'Channel 3',
    ),
  );
  assert.ok(
    FORM_DEFINITION_BY_TYPE['a6m-installation'].sections.some(
      (section) => section.title === 'Channel 6',
    ),
  );
});

test('every catalog field and label matches the audited iOS catalog snapshot', () => {
  const sectionCount = FORM_DEFINITIONS.reduce(
    (count, definition) => count + definition.sections.length,
    0,
  );
  const fieldCount = FORM_DEFINITIONS.reduce(
    (count, definition) =>
      count +
      definition.sections.reduce(
        (sectionFields, section) =>
          sectionFields + section.fields.length,
        0,
      ),
    0,
  );
  const fingerprint = createHash('sha256')
    .update(canonicalJson(FORM_DEFINITIONS))
    .digest('hex');

  assert.equal(sectionCount, 56);
  assert.equal(fieldCount, 392);
  assert.equal(
    fingerprint,
    '3158844d3c6de08a24b1a067062419584a5208696ce1d3fec2bca5e3a3db5bde',
  );
});

test('WW form exposes the exact device sensor choices and channel counts', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const channels = definition.sections.filter((section) =>
    section.title.startsWith('Channel '),
  );
  const firstRating = channels[0].fields.find(
    (field) => field.key === 'channel.1.rating',
  );
  const firstLoad = channels[0].fields.find(
    (field) => field.key === 'channel.1.load',
  );

  assert.ok(firstRating);
  assert.ok(firstLoad);
  assert.equal(channels.length, 6);
  assert.deepEqual(SENSOR_OPTIONS_BY_DEVICE.A3RM, [
    '10cm-200A',
    '10cm-333mV',
    '20cm-3000A',
    '30cm-3000A',
    '45cm-3000A',
    'Not Used',
  ]);
  assert.deepEqual(SENSOR_OPTIONS_BY_DEVICE.A6M, [
    'CT-60A',
    'CT-120A',
    'CT-250A',
    'CT-400A',
    'CT-600A',
    'Not Used',
  ]);
  assert.deepEqual(
    optionsForField(firstRating, { 'device.type': 'A3RM' }),
    SENSOR_OPTIONS_BY_DEVICE.A3RM,
  );
  assert.deepEqual(
    optionsForField(firstRating, { 'device.type': 'A6M' }),
    SENSOR_OPTIONS_BY_DEVICE.A6M,
  );
  assert.deepEqual(
    optionsForField(firstLoad, { 'channel.1.purpose': 'Main board supply' }),
    ['Mains Supply'],
  );
  assert.deepEqual(
    optionsForField(firstLoad, { 'channel.1.purpose': 'Sub-circuit / asset' }),
    ['HVAC', 'Lighting', 'Solar PV', 'Forklift Charger', 'Hot Water', 'General Power', 'Other'],
  );
  assert.equal(
    isSectionVisible(channels[3], { 'device.type': 'A3RM' }),
    false,
  );
  assert.equal(
    isSectionVisible(channels[5], { 'device.type': 'A6M' }),
    true,
  );
});

test('WW Base44 choices are presented while persisted legacy selections remain editable', () => {
  assert.deepEqual(SIGNALS, ['Low', 'Medium', 'High']);
  assert.deepEqual(ANTENNAS, [
    'Internal',
    'External',
    'CSM550 - External High Gain',
    'Other',
  ]);

  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const fields = definition.sections.flatMap((section) => section.fields);
  const switchboard = fields.find((field) => field.key === 'auditor.switchboard_type');
  const rating = fields.find((field) => field.key === 'channel.1.rating');
  assert.ok(switchboard);
  assert.ok(rating);
  assert.equal(switchboard.kind, 'select');
  assert.deepEqual(switchboard.options, SWITCHBOARD_TYPES);
  assert.deepEqual(
    editorOptionsForField(switchboard, {
      'auditor.switchboard_type': 'Historic custom board type',
    }),
    ['Historic custom board type', ...SWITCHBOARD_TYPES],
  );
  assert.ok(
    acceptedOptionsForField(rating, { 'device.type': 'A3RM' })
      .includes('3000A - 9cm'),
  );
  assert.deepEqual(
    editorOptionsForField(rating, {
      'device.type': 'A3RM',
      'channel.1.rating': '3000A - 9cm',
    }),
    ['3000A - 9cm', ...SENSOR_OPTIONS_BY_DEVICE.A3RM],
  );
});

test('WW channel contract matches the API and iOS parity signature', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const channelContract = Array.from({ length: 6 }, (_, index) => {
    const channel = index + 1;
    const section = definition.sections.find((candidate) =>
      candidate.fields.some((field) => field.key === `channel.${channel}.purpose`),
    );
    assert.ok(section, `channel ${channel} section is declared`);
    return {
      channel,
      showWhen: section.showWhen,
      fields: section.fields.map((field) => ({
        key: field.key,
        kind: field.kind,
        required: field.required ?? false,
        ...(field.options ? { options: field.options } : {}),
        ...(field.showWhen ? { showWhen: field.showWhen } : {}),
        ...(field.optionsWhen ? { optionsWhen: field.optionsWhen } : {}),
        ...(field.legacyOptionsWhen
          ? { legacyOptionsWhen: field.legacyOptionsWhen }
          : {}),
      })),
    };
  });

  assert.equal(
    createHash('sha256').update(canonicalJson(channelContract)).digest('hex'),
    '3b00b0da4b860d09c8fbe38771a186a4a314dc4b8775fe04d487f2f93a596713',
  );
});

test('conditional changes clear hidden values and identify hidden evidence', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const result = answersAfterChange(
    definition,
    {
      'device.type': 'A6M',
      'channel.4.purpose': 'SUB_CIRCUIT',
      'channel.4.load': 'HVAC',
      'channel.4.rating': '120A',
      'channel.4.description': 'Warehouse HVAC',
      'commissioning.channel_4_polarity': 'yes',
      'commissioning.channel_4_current': '18.2',
    },
    'channel.4.purpose',
    'SPARE',
  );

  assert.equal(result.answers['channel.4.purpose'], 'SPARE');
  assert.equal(result.answers['channel.4.load'], undefined);
  assert.equal(result.answers['channel.4.rating'], undefined);
  assert.equal(result.answers['channel.4.description'], undefined);
  assert.equal(
    result.answers['commissioning.channel_4_polarity'],
    undefined,
  );
  assert.equal(
    result.answers['commissioning.channel_4_current'],
    undefined,
  );
  assert.ok(
    result.hiddenPhotoSlots.includes('channel.4.nameplate_photos'),
  );
});

test('WW device custom name follows model defaults only while pristine', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const pristine = answersAfterChange(
    definition,
    { 'device.type': 'A3RM', 'device.name': 'A3RM Meter' },
    'device.type',
    'A6M',
  );
  assert.equal(pristine.answers['device.name'], 'A6M Meter');

  const edited = answersAfterChange(
    definition,
    { 'device.type': 'A3RM', 'device.name': 'Main incomer meter' },
    'device.type',
    'A6M',
  );
  assert.equal(edited.answers['device.name'], 'Main incomer meter');
});

test('device-number fields are presented as optional site tags, not serial identities', () => {
  const labels = FORM_DEFINITIONS.flatMap((definition) =>
    definition.sections.flatMap((section) =>
      section.fields
        .filter((field) => [
          'device.number',
          'existing.device_number',
          'works.new_device_number',
        ].includes(field.key))
        .map((field) => field.label),
    ),
  );
  assert.equal(labels.length, 3);
  for (const label of labels) {
    assert.match(label, /site \/ asset tag/i);
    assert.match(label, /optional/i);
    assert.match(label, /not the Device ID \/ serial/i);
  }
});

test('Comms replacement sensor visibility follows the selected replacement device type', () => {
  const sensor = FORM_DEFINITION_BY_TYPE['comms-fault'].sections
    .find((section) => section.title === 'On-site works')
    ?.fields.find(
      (field) => field.key === 'works.new_sensor_rating',
    );

  assert.ok(sensor);
  assert.equal(
    isFieldVisible(sensor, { 'works.replace_device': 'yes' }),
    false,
  );
  assert.equal(
    isFieldVisible(sensor, {
      'works.replace_device': 'yes',
      'works.new_device_type': 'A3RM',
    }),
    true,
  );
});

test('required yes/no, numeric, and select values reject invalid input', () => {
  assert.ok(
    validateForm(
      submission('ww-installation', {
        'prestart.safe_access': 'not_applicable',
      }),
    ).some((error) =>
      error.includes('Do you have safe access? has an invalid selection'),
    ),
  );
  assert.ok(
    validateForm(
      submission('honeywell-q400', {
        'site.latitude': 'not-a-coordinate',
      }),
    ).some((error) => error.includes('Latitude must be a number')),
  );
  assert.ok(
    validateForm(
      submission('comms-fault', {
        'existing.signal': 'Invented signal',
      }),
    ).some((error) =>
      error.includes(
        'Existing signal strength has an invalid selection',
      ),
    ),
  );
});

test('form validation retains stable field keys for summaries, inline errors, and focus', () => {
  const issues = formValidationIssues(
    submission('ww-installation', {
      'prestart.safe_access': 'not_applicable',
    }),
  );
  assert.ok(issues.some((issue) => (
    issue.fieldKey === 'prestart.safe_access'
    && issue.message.includes('has an invalid selection')
  )));
});

test('legacy draft records retain the same required-field validation as iOS', () => {
  assert.ok(
    validateForm(
      submission('a3rm-installation', {
        'device.type': 'A3RM',
      }),
    ).some((error) => error.includes('Date and time')),
  );
});

test('Comms replacement mirrors iOS meter reshaping', () => {
  const meter: Meter = {
    id: 'meter-1',
    deviceName: 'A6M Auditor',
    deviceType: 'A6M',
    deviceId: 'OLD-ID',
    deviceNumber: 'OLD-NUMBER',
    wwChannels: Array.from({ length: 6 }, (_, index) => ({
      loadType: index < 3 ? 'Mains Supply' : 'Not Used',
      description: `Channel ${index + 1}`,
      ctRatio: '120A',
    })),
  };
  const replacement = meterAfterCommsReplacement(meter, {
    'works.new_device_type': 'A3RM',
    'works.new_device_number': 'NEW-NUMBER',
    'works.new_device_id': 'NEW-ID',
    'works.new_sensor_rating': '3000A - 20cm',
  });

  assert.equal(replacement.deviceType, 'A3RM');
  assert.equal(replacement.deviceId, 'NEW-ID');
  assert.equal(replacement.deviceNumber, 'NEW-NUMBER');
  assert.equal(replacement.wwChannels?.length, 3);
  assert.equal(
    replacement.wwChannels?.[0].rogowskiSize,
    '3000A - 20cm',
  );
  assert.equal(replacement.wwChannels?.[0].ctRatio, undefined);
});

test('scanner modes match iOS ingestion fields', () => {
  const fields = Object.fromEntries(
    FORM_DEFINITIONS.flatMap((definition) =>
      definition.sections.flatMap((section) =>
        section.fields.map((field) => [
          `${definition.type}:${field.key}`,
          field,
        ]),
      ),
    ),
  );

  for (const key of [
    'ww-installation:device.number',
    'ww-installation:device.id',
    'comms-fault:existing.device_number',
    'comms-fault:existing.device_id',
    'comms-fault:works.new_device_number',
    'comms-fault:works.new_device_id',
    'ace-switchboard:job.number',
    'ace-switchboard:install.ct_serial_a',
    'ace-switchboard:install.ct_serial_b',
    'ace-switchboard:install.ct_serial_c',
    'honeywell-q400:water.serial_number',
    'captis-logger:meter.serial_number',
    'captis-logger:logger.serial_number',
  ]) {
    assert.deepEqual(fields[key]?.scanModes, ['barcode'], key);
  }
  assert.ok(
    fields['ww-installation:auditor.address_map_locator'],
    'production address/map locator remains available',
  );
  assert.deepEqual(
    fields['ace-switchboard:job.qr_link']?.scanModes,
    ['qr'],
  );
  assert.deepEqual(
    fields['sums-logger:meter.serial_number']?.scanModes,
    ['barcode', 'qr'],
  );
  assert.deepEqual(
    fields['sums-logger:logger.serial_number']?.scanModes,
    ['barcode', 'qr'],
  );

  const hiddenPhoto = FORM_DEFINITION_BY_TYPE['ww-installation']
    .sections.find((section) => section.title === 'Channel 4')
    ?.fields.find(
      (field) => field.key === 'channel.4.nameplate_photos',
    );
  assert.ok(hiddenPhoto);
  assert.equal(
    isFieldVisible(hiddenPhoto, {
      'device.type': 'A6M',
      'channel.4.load': 'Not Used',
    }),
    false,
  );
});

test('SUMS retains the exact Captis answer-key shape', () => {
  const fieldKeys = (
    type: 'captis-logger' | 'sums-logger',
  ) =>
    FORM_DEFINITION_BY_TYPE[type].sections.flatMap((section) =>
      section.fields.map((field) => field.key),
    );

  assert.deepEqual(
    fieldKeys('sums-logger'),
    fieldKeys('captis-logger'),
  );
});
