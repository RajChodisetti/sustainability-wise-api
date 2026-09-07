import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const boardSource = readFileSync(
  new URL('../pages/BoardPage.tsx', import.meta.url),
  'utf8',
);
const meterSource = readFileSync(
  new URL('../pages/MeterPage.tsx', import.meta.url),
  'utf8',
);

test('switchboard save opens the saved switchboard view', () => {
  assert.match(
    boardSource,
    /router\.replace\(`\/installhub\/installations\/\$\{installationId\}\/zones\/\$\{zoneId\}\/boards\/\$\{currentDraft\.id\}`\)/,
  );
  assert.doesNotMatch(boardSource, /then commission devices and add evidence/);
});

test('portal meter labels remain the parity source for mobile authoring', () => {
  [
    'Device identity',
    'Device family',
    'Device model',
    'Manufacturer',
    'Custom model',
    'Device name',
    'Generated asset ID',
    'Device ID / serial',
    'Site / asset tag (optional)',
    'Classification',
    'Coverage',
    'Operational notes',
    'Pre-start safety',
    'Switchboard details',
    'Custom load type',
    'Sensor rating / metadata',
    'Meter evidence',
    'Installed device',
    'Switchboard overview',
    'Device and channel labeling',
    'Extra meter photos',
  ].forEach((label) => assert.ok(meterSource.includes(label), `${label} should be present`));
});

test('portal channel editor defines the mobile field order, actions, and suggestions', () => {
  [
    'Three channels for A3RM, six for A6M, or one or more explicit custom channels.',
    'Restore channel layout',
    'Add channel',
    'Add site asset',
    'Remove',
    'Purpose',
    'Load type',
    'Custom load type',
    'CT rating',
    'Rogowski coil',
    'Description',
    'Phase label',
    'Sensor rating / metadata',
    'Select an option',
    'Channel capabilities',
    'Add capability',
  ].forEach((label) => assert.ok(meterSource.includes(label), `${label} should be present`));
  assert.match(meterSource, /const CT_RATINGS: readonly string\[\] = \['60A', '120A', '200A', '400A', '600A'\]/);
  assert.match(meterSource, /'3000A – 9cm',[\s\S]*'3000A – 20cm',[\s\S]*'3000A – 29cm'/);
  assert.match(meterSource, /\{CT_RATINGS\.map\(\(option\) => \(/);
  assert.match(meterSource, /\{ROGOWSKI_SIZES\.map\(\(option\) => \(/);
  assert.doesNotMatch(meterSource, /withLegacyOption\(\s*CT_RATINGS/);
  assert.doesNotMatch(meterSource, /withLegacyOption\(\s*ROGOWSKI_SIZES/);
  assert.match(meterSource, /meterChannelAfterDeviceTypeChange\(current\.deviceType, type,/);
  assert.match(meterSource, /meterChannelWithModelValidSensor\(current\.deviceType,/);
  assert.match(meterSource, /meterChannelWithModelValidSensor\(editableDraft\.deviceType,/);

  const channelStart = meterSource.indexOf('id={`meter-channel-${index + 1}`}');
  const purposeIndex = meterSource.indexOf('>Purpose</FieldLabel>', channelStart);
  const loadIndex = meterSource.indexOf('>Load type</FieldLabel>', purposeIndex);
  const customIndex = meterSource.indexOf('>Custom load type</FieldLabel>', loadIndex);
  const descriptionIndex = meterSource.indexOf('>Description</FieldLabel>', customIndex);
  const phaseIndex = meterSource.indexOf('>Phase label</FieldLabel>', descriptionIndex);
  const sensorIndex = meterSource.indexOf('>Sensor rating / metadata</FieldLabel>', phaseIndex);
  const capabilityIndex = meterSource.indexOf('>Channel capabilities</h4>', sensorIndex);
  assert.ok(
    channelStart < purposeIndex
      && purposeIndex < loadIndex
      && loadIndex < customIndex
      && customIndex < descriptionIndex
      && descriptionIndex < phaseIndex
      && phaseIndex < sensorIndex
      && sensorIndex < capabilityIndex,
  );
});
