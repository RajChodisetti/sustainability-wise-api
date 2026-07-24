import assert from 'node:assert/strict';
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
      if (!visible(field.showWhen, answers) || !field.required) continue;
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

test('generated finalized fixtures satisfy every required field and photo for all six forms', () => {
  for (const formType of Object.keys(
    INSTALLHUB_SCHEMA_V2_FORM_DEFINITIONS,
  ) as CurrentFormType[]) {
    const fixture = generatedCompletedFixture(formType);
    assert.doesNotThrow(
      () => validateInstallHubFormContract(fixture),
      `${formType} should satisfy its schema-v2 manifest`,
    );
  }
});

test('metadata stage may omit evidence but still requires every completed answer', () => {
  const fixture = generatedCompletedFixture('honeywell-q400');
  assert.doesNotThrow(() => validateInstallHubFormContract({
    ...fixture,
    attachments: [],
    syncStage: 'metadata',
  }));

  delete fixture.answers['water.serial_number'];
  assert.throws(
    () => validateInstallHubFormContract({
      ...fixture,
      attachments: [],
      syncStage: 'metadata',
    }),
    detailMatches(/answers\.water\.serial_number/),
  );
});

test('complete and legacy-final stages require every visible required photo slot', () => {
  const fixture = generatedCompletedFixture('honeywell-q400');
  fixture.attachments = fixture.attachments.filter(
    (item) => item.slot !== 'water.lcd_photo',
  );

  assert.throws(
    () => validateInstallHubFormContract(fixture),
    detailMatches(/attachments slot water\.lcd_photo/),
  );
  assert.throws(
    () => validateInstallHubFormContract({
      ...fixture,
      syncStage: undefined,
    }),
    detailMatches(/attachments slot water\.lcd_photo/),
  );
});

test('drafts remain incomplete but validate any value they do contain', () => {
  assert.doesNotThrow(() => validateInstallHubFormContract({
    formType: 'ace-switchboard',
    schemaVersion: 2,
    status: 'Draft',
    answers: {},
    attachments: [],
    syncStage: 'complete',
  }));
  assert.throws(
    () => validateInstallHubFormContract({
      formType: 'ace-switchboard',
      schemaVersion: 2,
      status: 'Draft',
      answers: { 'testing.phase_a_voltage': 'not-a-number' },
      attachments: [],
      syncStage: 'metadata',
    }),
    detailMatches(/must be a number/),
  );
});

test('WW installation enforces exact A3RM and A6M conditional sensor choices', () => {
  const a3rm = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  assert.doesNotThrow(() => validateInstallHubFormContract(a3rm));
  assert.equal(a3rm.answers['channel.1.rating'], '3000A - 9cm');
  assert.equal(a3rm.answers['channel.4.load'], undefined);

  a3rm.answers['channel.1.rating'] = '60A';
  assert.throws(
    () => validateInstallHubFormContract(a3rm),
    detailMatches(/channel\.1\.rating is not a valid selection/),
  );

  const a6m = generatedCompletedFixture('ww-installation', {
    'device.type': 'A6M',
  });
  assert.equal(a6m.answers['channel.1.rating'], '60A');
  assert.doesNotThrow(() => validateInstallHubFormContract(a6m));
});

test('WW Not Used channels reject hidden rating, description, evidence and commissioning data', () => {
  const fixture = generatedCompletedFixture('ww-installation', {
    'device.type': 'A6M',
  });
  fixture.answers['channel.4.load'] = 'Not Used';
  delete fixture.answers['channel.4.rating'];
  assert.doesNotThrow(() => validateInstallHubFormContract(fixture));

  for (const [key, value] of [
    ['channel.4.rating', '60A'],
    ['channel.4.description', 'stale load'],
    ['commissioning.channel_4_polarity', 'yes'],
    ['commissioning.channel_4_current', '12'],
  ] as const) {
    fixture.answers[key] = value;
    assert.throws(
      () => validateInstallHubFormContract(fixture),
      detailMatches(/must be empty while the field is hidden/),
      key,
    );
    delete fixture.answers[key];
  }

  fixture.attachments.push(attachment('channel.4.nameplate_photos', 'stale-channel-4'));
  assert.throws(
    () => validateInstallHubFormContract(fixture),
    detailMatches(/channel\.4\.nameplate_photos.*hidden/),
  );
});

test('A3RM rejects all hidden channel 4-6 answers and photos', () => {
  const fixture = generatedCompletedFixture('ww-installation', {
    'device.type': 'A3RM',
  });
  fixture.answers['channel.4.load'] = 'Mains Supply';
  assert.throws(
    () => validateInstallHubFormContract(fixture),
    detailMatches(/channel\.4\.load.*hidden/),
  );
  delete fixture.answers['channel.4.load'];

  fixture.attachments.push(attachment('channel.4.nameplate_photos', 'a3rm-hidden-channel'));
  assert.throws(
    () => validateInstallHubFormContract(fixture),
    detailMatches(/channel\.4\.nameplate_photos.*hidden/),
  );
});

test('communications replacement requires conditional fields and evidence only when selected', () => {
  const replacement = generatedCompletedFixture('comms-fault');
  assert.equal(replacement.answers['works.replace_device'], 'yes');
  assert.doesNotThrow(() => validateInstallHubFormContract(replacement));

  delete replacement.answers['works.new_device_id'];
  assert.throws(
    () => validateInstallHubFormContract(replacement),
    detailMatches(/answers\.works\.new_device_id/),
  );

  const noReplacement = generatedCompletedFixture('comms-fault', {
    'works.replace_device': 'no',
  });
  assert.doesNotThrow(() => validateInstallHubFormContract(noReplacement));
  noReplacement.answers['works.new_device_id'] = 'stale-device';
  assert.throws(
    () => validateInstallHubFormContract(noReplacement),
    detailMatches(/works\.new_device_id.*hidden/),
  );
  delete noReplacement.answers['works.new_device_id'];
  noReplacement.attachments.push(
    attachment('commissioning.start_screenshot', 'stale-replacement-photo'),
  );
  assert.throws(
    () => validateInstallHubFormContract(noReplacement),
    detailMatches(/commissioning\.start_screenshot.*hidden/),
  );
});

test('all schema-v2 yes/no, numeric and select values use the mobile catalog types', () => {
  const honeywell = generatedCompletedFixture('honeywell-q400');
  honeywell.answers['water.activated'] = 'not_applicable';
  assert.throws(
    () => validateInstallHubFormContract(honeywell),
    detailMatches(/water\.activated must be yes or no/),
  );

  const captis = generatedCompletedFixture('captis-logger');
  captis.answers['logger.rsrp'] = 'NaN';
  assert.throws(
    () => validateInstallHubFormContract(captis),
    detailMatches(/logger\.rsrp must be a number/),
  );

  const ww = generatedCompletedFixture('ww-installation');
  ww.answers['commissioning.signal_strength'] = 'Strong-ish';
  assert.throws(
    () => validateInstallHubFormContract(ww),
    detailMatches(/signal_strength is not a valid selection/),
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
    detailMatches(/Unsupported InstallHub formType/),
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
