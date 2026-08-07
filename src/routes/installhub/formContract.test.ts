import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS,
  type InstallHubContractDefinition,
  type InstallHubContractField,
  type InstallHubFormAttachment,
  validateInstallHubFormContract,
} from './formContract.js';

type CurrentFormType = keyof typeof INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS;
type Answers = Record<string, string>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(
        (value as Record<string, unknown>)[key],
      )}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function detailMatches(pattern: RegExp) {
  return (error: unknown) => (
    error instanceof Error
    && 'detail' in error
    && typeof error.detail === 'string'
    && pattern.test(error.detail)
  );
}

function visible(
  condition: InstallHubContractField['showWhen'],
  answers: Answers,
): boolean {
  if (!condition) return true;
  const conditions = Array.isArray(condition) ? condition : [condition];
  return conditions.every((item) => {
    const expected = Array.isArray(item.equals) ? item.equals : [item.equals];
    return expected.includes(answers[item.key] ?? '');
  });
}

function optionsFor(field: InstallHubContractField, answers: Answers): readonly string[] {
  if (field.optionsWhen) {
    return field.optionsWhen.values[answers[field.optionsWhen.key] ?? ''] ?? [];
  }
  return field.options ?? [];
}

function generatedRequiredValue(
  field: InstallHubContractField,
  answers: Answers,
): string {
  if (field.kind === 'yesno') return 'yes';
  if (field.kind === 'number') return '1';
  if (field.kind === 'select') {
    const selected = optionsFor(field, answers)[0];
    assert.ok(selected, `fixture field ${field.key} has a selectable option`);
    return selected;
  }
  return `value-${field.key}`;
}

function attachment(slot: string, suffix = slot): InstallHubFormAttachment {
  return {
    id: `attachment-${suffix}`,
    slot,
    uri: `https://files.example.test/${encodeURIComponent(suffix)}.jpg`,
    mimeType: 'image/jpeg',
    caption: null,
    capturedAt: '2026-07-23T12:00:00.000Z',
  };
}

function generatedCompletedFixture(
  formType: CurrentFormType,
  initialAnswers: Answers = {},
): {
  formType: CurrentFormType;
  schemaVersion: 2;
  status: 'Completed';
  answers: Answers;
  attachments: InstallHubFormAttachment[];
  syncStage: 'complete';
} {
  const definition: InstallHubContractDefinition =
    INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS[formType];
  const answers = { ...initialAnswers };
  const attachments: InstallHubFormAttachment[] = [];

  for (const section of definition.sections) {
    if (!visible(section.showWhen, answers)) continue;
    for (const field of section.fields) {
      if (!visible(field.showWhen, answers)) continue;
      if (field.kind === 'photo') {
        attachments.push(attachment(field.key));
      } else if (!answers[field.key]) {
        answers[field.key] = generatedRequiredValue(field, answers);
      }
    }
  }

  return {
    formType,
    schemaVersion: 2,
    status: 'Completed',
    answers,
    attachments,
    syncStage: 'complete',
  };
}

test('every schema-v2 field is optional and finalized fixtures remain accepted', () => {
  for (const formType of Object.keys(
    INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS,
  ) as CurrentFormType[]) {
    assert.ok(
      INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS[formType].sections.every(
        (section) => section.fields.every((field) => field.required === false),
      ),
      `${formType} must not expose mandatory answer or evidence fields`,
    );
    const fixture = generatedCompletedFixture(formType);
    assert.doesNotThrow(
      () => validateInstallHubFormContract(fixture),
      `${formType} should satisfy its schema-v2 manifest`,
    );
  }
});

test('metadata and complete stages may omit every optional answer and evidence slot', () => {
  const fixture = generatedCompletedFixture('honeywell-q400');
  assert.doesNotThrow(() => validateInstallHubFormContract({
    ...fixture,
    attachments: [],
    syncStage: 'metadata',
  }));

  delete fixture.answers['water.serial_number'];
  assert.doesNotThrow(
    () => validateInstallHubFormContract({
      ...fixture,
      attachments: [],
      syncStage: 'metadata',
    }),
  );
});

test('complete and legacy-final stages accept missing evidence', () => {
  const fixture = generatedCompletedFixture('honeywell-q400');
  fixture.attachments = fixture.attachments.filter(
    (item) => item.slot !== 'water.lcd_photo',
  );

  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
  assert.doesNotThrow(
    () => validateInstallHubFormContract({
      ...fixture,
      syncStage: undefined,
    }),
  );
});

test('drafts and completed forms retain any observed text value', () => {
  assert.doesNotThrow(() => validateInstallHubFormContract({
    formType: 'ace-switchboard',
    schemaVersion: 2,
    status: 'Draft',
    answers: {},
    attachments: [],
    syncStage: 'complete',
  }));
  assert.doesNotThrow(
    () => validateInstallHubFormContract({
      formType: 'ace-switchboard',
      schemaVersion: 2,
      status: 'Draft',
      answers: { 'testing.phase_a_voltage': 'not-a-number' },
      attachments: [],
      syncStage: 'metadata',
    }),
  );
});

test('WW installation presents Base44 choices and accepts persisted legacy choices', () => {
  const a3rm = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  assert.doesNotThrow(() => validateInstallHubFormContract(a3rm));
  assert.equal(a3rm.answers['channel.1.rating'], '10cm-200A');
  assert.equal(a3rm.answers['channel.4.load'], undefined);

  a3rm.answers['channel.1.rating'] = '3000A - 9cm';
  a3rm.answers['commissioning.signal_strength'] = 'Excellent';
  a3rm.answers['commissioning.antenna_type'] = 'N/A';
  assert.doesNotThrow(() => validateInstallHubFormContract(a3rm));

  a3rm.answers['channel.1.rating'] = 'CT-60A';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(a3rm),
  );

  const a6m = generatedCompletedFixture('ww-installation', {
    'device.type': 'A6M',
  });
  assert.equal(a6m.answers['channel.1.rating'], 'CT-60A');
  assert.doesNotThrow(() => validateInstallHubFormContract(a6m));
  a6m.answers['channel.1.rating'] = '60A';
  assert.doesNotThrow(() => validateInstallHubFormContract(a6m));
});

test('WW channel contract accepts the canonical purpose and conditional load shape', () => {
  const purposeOptions = [
    'Main board supply',
    'Sub-circuit / asset',
    'Spare / unused',
  ];
  const loadOptions = [
    'Mains Supply',
    'HVAC',
    'Lighting',
    'Solar PV',
    'Forklift Charger',
    'Hot Water',
    'General Power',
    'Other',
    'Not Used',
  ];
  const definition = INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS['ww-installation'];
  const channelContract = [];

  for (let channel = 1; channel <= 6; channel += 1) {
    const section = definition.sections.find((candidate) => (
      candidate.fields.some((field) => field.key === `channel.${channel}.purpose`)
    ));
    assert.ok(section, `channel ${channel} section is declared`);
    channelContract.push({
      channel,
      showWhen: section.showWhen,
      fields: section.fields,
    });
  }

  assert.equal(channelContract.length, 6);
  assert.deepEqual(channelContract, Array.from({ length: 6 }, (_, index) => {
    const channel = index + 1;
    const prefix = `channel.${channel}`;
    const loadVisible = {
      key: `${prefix}.purpose`,
      equals: purposeOptions.slice(0, 2),
    };
    const usedLoadVisible = {
      key: `${prefix}.load`,
      equals: loadOptions.slice(0, -1),
    };
    return {
      channel,
      showWhen: {
        key: 'device.type',
        equals: channel <= 3 ? ['A3RM', 'A6M'] : 'A6M',
      },
      fields: [
        {
          key: `${prefix}.purpose`,
          kind: 'select',
          options: purposeOptions,
          required: false,
        },
        {
          key: `${prefix}.load`,
          kind: 'select',
          required: false,
          optionsWhen: {
            key: `${prefix}.purpose`,
            values: {
              'Main board supply': ['Mains Supply'],
              'Sub-circuit / asset': loadOptions.slice(1, -1),
            },
          },
          showWhen: loadVisible,
        },
        {
          key: `${prefix}.custom_load_type`,
          kind: 'text',
          required: false,
          showWhen: { key: `${prefix}.load`, equals: 'Other' },
        },
        {
          key: `${prefix}.rating`,
          kind: 'select',
          required: false,
          optionsWhen: {
            key: 'device.type',
            values: {
              A3RM: [
                '10cm-200A',
                '10cm-333mV',
                '20cm-3000A',
                '30cm-3000A',
                '45cm-3000A',
                'Not Used',
              ],
              A6M: [
                'CT-60A',
                'CT-120A',
                'CT-250A',
                'CT-400A',
                'CT-600A',
                'Not Used',
              ],
            },
          },
          legacyOptionsWhen: {
            key: 'device.type',
            values: {
              A3RM: ['3000A - 9cm', '3000A - 20cm', '3000A - 29cm'],
              A6M: ['60A', '120A', '200A', '400A', '600A'],
            },
          },
          showWhen: usedLoadVisible,
        },
        {
          key: `${prefix}.description`,
          kind: 'text',
          required: false,
          showWhen: usedLoadVisible,
        },
        {
          key: `${prefix}.nameplate_photos`,
          kind: 'photo',
          required: false,
          showWhen: usedLoadVisible,
        },
      ],
    };
  }));
  assert.equal(
    createHash('sha256').update(canonicalJson(channelContract)).digest('hex'),
    'fde8e7b441b6607221a658fba6dfce3ab49e76dda1b03338d5af539d3d0c31b3',
  );

  assert.doesNotThrow(() => validateInstallHubFormContract({
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Draft',
    answers: {
      'device.type': 'A3RM',
      'channel.1.purpose': 'Main board supply',
      'channel.1.load': 'Mains Supply',
    },
    attachments: [],
  }));
});

test('WW current load values are advisory and never completion gates', () => {
  const draft = (purpose: string, load: string) => ({
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Draft',
    answers: {
      'device.type': 'A3RM',
      'channel.1.purpose': purpose,
      'channel.1.load': load,
    },
    attachments: [],
  });

  assert.doesNotThrow(() => validateInstallHubFormContract(
    draft('Main board supply', 'Mains Supply'),
  ));
  assert.doesNotThrow(() => validateInstallHubFormContract(
    draft('Sub-circuit / asset', 'HVAC'),
  ));
  for (const invalid of [
    draft('Main board supply', 'HVAC'),
    draft('Sub-circuit / asset', 'Mains Supply'),
    draft('Sub-circuit / asset', 'Not Used'),
  ]) {
    assert.doesNotThrow(
      () => validateInstallHubFormContract(invalid),
    );
  }
  assert.doesNotThrow(
    () => validateInstallHubFormContract(draft('Spare / unused', 'Not Used')),
  );
});

test('WW Other custom labels are optional and hidden legacy values are retained', () => {
  const fixture = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  fixture.answers['channel.1.purpose'] = 'Sub-circuit / asset';
  fixture.answers['channel.1.load'] = 'Other';

  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );

  fixture.answers['channel.1.custom_load_type'] = 'Packaging line';
  fixture.answers['channel.1.description'] = 'Feeds the west-side conveyor';
  assert.doesNotThrow(() => validateInstallHubFormContract(fixture));

  fixture.answers['channel.1.load'] = 'HVAC';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
});

test('WW spare channels may retain optional purpose and load details', () => {
  const fixture = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  fixture.answers['channel.1.purpose'] = 'Spare / unused';
  delete fixture.answers['channel.1.load'];
  delete fixture.answers['channel.1.rating'];
  assert.doesNotThrow(() => validateInstallHubFormContract(fixture));

  fixture.answers['channel.1.load'] = 'Not Used';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
  delete fixture.answers['channel.1.load'];

  fixture.answers['channel.1.purpose'] = 'Unused';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );

  delete fixture.answers['channel.1.purpose'];
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
});

test('WW spare channels retain optional rating, description, evidence and commissioning data', () => {
  const fixture = generatedCompletedFixture('ww-installation', {
    'device.type': 'A6M',
  });
  fixture.answers['channel.4.purpose'] = 'Spare / unused';
  delete fixture.answers['channel.4.load'];
  delete fixture.answers['channel.4.rating'];
  assert.doesNotThrow(() => validateInstallHubFormContract(fixture));

  for (const [key, value] of [
    ['channel.4.rating', '60A'],
    ['channel.4.description', 'stale load'],
    ['commissioning.channel_4_polarity', 'yes'],
    ['commissioning.channel_4_current', '12'],
  ] as const) {
    fixture.answers[key] = value;
    assert.doesNotThrow(
      () => validateInstallHubFormContract(fixture),
    );
    delete fixture.answers[key];
  }

  fixture.attachments.push(attachment('channel.4.nameplate_photos', 'stale-channel-4'));
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
});

test('load-only WW compatibility is non-mutating and accepted in every lifecycle context', () => {
  const historical = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  historical.answers['channel.2.load'] = 'Other';
  delete historical.answers['channel.2.description'];
  historical.answers['channel.3.load'] = 'Not Used';
  delete historical.answers['channel.3.rating'];
  for (let channel = 1; channel <= 3; channel += 1) {
    delete historical.answers[`channel.${channel}.purpose`];
    delete historical.answers[`channel.${channel}.custom_load_type`];
  }
  const before = structuredClone(historical.answers);

  assert.doesNotThrow(
    () => validateInstallHubFormContract(historical),
  );
  assert.doesNotThrow(() => validateInstallHubFormContract({
    ...historical,
    status: 'Draft',
    syncStage: 'metadata',
  }));
  assert.doesNotThrow(() => validateInstallHubFormContract({
    ...historical,
    allowLegacyCompletedWwLoadOnly: true,
  }));
  assert.deepEqual(historical.answers, before);

  const partialCurrent = structuredClone(historical);
  partialCurrent.answers['channel.1.purpose'] = 'Main board supply';
  assert.doesNotThrow(
    () => validateInstallHubFormContract({
      ...partialCurrent,
      allowLegacyCompletedWwLoadOnly: true,
    }),
  );

  const currentOther = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  currentOther.answers['channel.2.purpose'] = 'Sub-circuit / asset';
  currentOther.answers['channel.2.load'] = 'Other';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(currentOther),
  );
});

test('A3RM retains optional channel 4-6 legacy answers and photos', () => {
  const fixture = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  fixture.answers['channel.4.load'] = 'Mains Supply';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
  delete fixture.answers['channel.4.load'];

  fixture.attachments.push(attachment('channel.4.nameplate_photos', 'a3rm-hidden-channel'));
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
});

test('communications replacement fields and evidence stay optional in every branch', () => {
  const replacement = generatedCompletedFixture('comms-fault');
  assert.equal(replacement.answers['works.replace_device'], 'yes');
  assert.doesNotThrow(() => validateInstallHubFormContract(replacement));

  delete replacement.answers['existing.device_number'];
  delete replacement.answers['works.new_device_number'];
  assert.doesNotThrow(() => validateInstallHubFormContract(replacement));

  delete replacement.answers['works.new_device_id'];
  assert.doesNotThrow(
    () => validateInstallHubFormContract(replacement),
  );

  const noReplacement = generatedCompletedFixture('comms-fault', {
    'works.replace_device': 'no',
  });
  assert.doesNotThrow(() => validateInstallHubFormContract(noReplacement));
  noReplacement.answers['works.new_device_id'] = 'stale-device';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(noReplacement),
  );
  delete noReplacement.answers['works.new_device_id'];
  noReplacement.attachments.push(
    attachment('commissioning.start_screenshot', 'stale-replacement-photo'),
  );
  assert.doesNotThrow(
    () => validateInstallHubFormContract(noReplacement),
  );
});

test('WW installation keeps both device identity fields optional', () => {
  const fixture = generatedCompletedFixture('ww-installation');
  delete fixture.answers['device.number'];
  assert.doesNotThrow(() => validateInstallHubFormContract(fixture));

  delete fixture.answers['device.id'];
  assert.doesNotThrow(
    () => validateInstallHubFormContract(fixture),
  );
});

test('schema-v2 observed values do not become completion validation issues', () => {
  const honeywell = generatedCompletedFixture('honeywell-q400');
  honeywell.answers['water.activated'] = 'not_applicable';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(honeywell),
  );

  const captis = generatedCompletedFixture('captis-logger');
  captis.answers['logger.rsrp'] = 'NaN';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(captis),
  );

  const ww = generatedCompletedFixture('ww-installation');
  ww.answers['commissioning.signal_strength'] = 'Strong-ish';
  assert.doesNotThrow(
    () => validateInstallHubFormContract(ww),
  );
});

test('attachments require a unique identity, image metadata, timestamp and remote HTTP(S) URI', () => {
  const fixture = generatedCompletedFixture('honeywell-q400');
  const base = fixture.attachments[0]!;

  for (const [patch, expected] of [
    [{ uri: 'file:///device/photo.jpg' }, /remote HTTP\(S\) URL/],
    [{ uri: 'content://device/photo.jpg' }, /remote HTTP\(S\) URL/],
    [{ mimeType: 'application/pdf' }, /image MIME type/],
    [{ capturedAt: 'not-a-date' }, /must be an ISO date/],
  ] as const) {
    assert.throws(
      () => validateInstallHubFormContract({
        ...fixture,
        attachments: [{ ...base, ...patch }, ...fixture.attachments.slice(1)],
      }),
      detailMatches(expected),
    );
  }

  assert.throws(
    () => validateInstallHubFormContract({
      ...fixture,
      attachments: [base, { ...fixture.attachments[1]!, id: base.id }],
    }),
    detailMatches(/Duplicate attachment id/),
  );
  assert.throws(
    () => validateInstallHubFormContract({
      ...fixture,
      attachments: [...fixture.attachments, attachment('invented.photo')],
    }),
    detailMatches(/not supported for honeywell-q400/),
  );
  assert.throws(
    () => validateInstallHubFormContract({
      ...fixture,
      attachments: [{ ...base, uri: 'file:///still-local.jpg' }],
      syncStage: 'metadata',
    }),
    detailMatches(/remote HTTP\(S\) URL/),
  );
});

test('schema-v2 rejects unsupported answer keys instead of silently persisting drift', () => {
  const fixture = generatedCompletedFixture('sums-logger');
  fixture.answers['logger.invented'] = 'stale';
  assert.throws(
    () => validateInstallHubFormContract(fixture),
    detailMatches(/not supported for sums-logger/),
  );
});

test('schema-v1 communications and legacy auditor forms remain backward compatible', () => {
  for (const form of [
    {
      formType: 'comms-fault',
      schemaVersion: 1,
      status: 'Completed',
      answers: {
        'existing.serial_number': 'LEGACY-ID',
        'existing.device_type': 'A3RM',
      },
    },
    {
      formType: 'a3rm-installation',
      schemaVersion: 1,
      status: 'Completed',
      answers: {},
    },
    {
      formType: 'a6m-installation',
      schemaVersion: 1,
      status: 'Completed',
      answers: {},
    },
  ]) {
    assert.doesNotThrow(() => validateInstallHubFormContract(form));
  }
});

test('rejects unknown types, invalid versions/statuses and non-string answers', () => {
  assert.throws(
    () => validateInstallHubFormContract({
      formType: 'invented',
      schemaVersion: 2,
      status: 'Draft',
      answers: {},
    }),
    detailMatches(/Unsupported Field App Complete formType/),
  );
  assert.throws(
    () => validateInstallHubFormContract({
      formType: 'captis-logger',
      schemaVersion: 2,
      status: 'Draft',
      answers: { invalid: 42 },
    }),
    detailMatches(/must be a string/),
  );
  assert.throws(
    () => validateInstallHubFormContract({
      formType: 'captis-logger',
      schemaVersion: 2,
      status: 'Complete',
      answers: {},
    }),
    detailMatches(/status must be Draft or Completed/),
  );
  assert.throws(
    () => validateInstallHubFormContract({
      formType: 'a3rm-installation',
      schemaVersion: 2,
      status: 'Draft',
      answers: {},
    }),
    detailMatches(/does not support schemaVersion 2/),
  );
});
