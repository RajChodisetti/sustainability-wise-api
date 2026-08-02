import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type {
  FormSubmission,
  Meter,
} from '@/modules/installhub/types/domain';
import {
  FORM_DEFINITION_BY_TYPE,
  FORM_DEFINITIONS,
  SENSOR_OPTIONS_BY_DEVICE,
  answersAfterChange,
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
  assert.equal(fieldCount, 384);
  assert.equal(
    fingerprint,
    'bcaf7b3343a39e7fd937c78ab7f150bb0e3fe236cbd32597758d7b6772665852',
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

  assert.ok(firstRating);
  assert.equal(channels.length, 6);
  assert.deepEqual(
    optionsForField(firstRating, { 'device.type': 'A3RM' }),
    SENSOR_OPTIONS_BY_DEVICE.A3RM,
  );
  assert.deepEqual(
    optionsForField(firstRating, { 'device.type': 'A6M' }),
    SENSOR_OPTIONS_BY_DEVICE.A6M,
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
    'works.new_device_id': 'NEW-ID',
    'works.new_device_number': 'NEW-NUMBER',
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
