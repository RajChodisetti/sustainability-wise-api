import assert from 'node:assert/strict';
import test from 'node:test';
import { getEquipmentConfig } from './equipmentConfig';

test('lighting uses the mobile switchboard controls photo field in the portal', () => {
  const lighting = getEquipmentConfig('lighting-systems');
  const controlsPhoto = lighting?.fields.find((field) => field.key === 'switchboardControlsPhoto');

  assert.deepEqual(controlsPhoto, {
    key: 'switchboardControlsPhoto',
    label: 'Switchboard / Lighting Controls Photo',
    kind: 'photo',
  });
  assert.equal(lighting?.fields.some((field) => field.key === 'switchboardPhotoNotes'), false);
});

test('water assets expose four subtype forms through the shared API collection', () => {
  assert.equal(getEquipmentConfig('water-assets')?.apiSlug, 'water-assets');
  assert.equal(getEquipmentConfig('water-assets')?.assetType, undefined);
  const waterTypes = [
    ['water-meters', 'water_meter'],
    ['water-submeters-loggers', 'water_submeter_logger'],
    ['water-fixtures', 'water_fixture'],
    ['water-assets-systems', 'water_asset_system'],
  ] as const;

  for (const [slug, assetType] of waterTypes) {
    const config = getEquipmentConfig(slug);
    assert.equal(config?.apiSlug, 'water-assets');
    assert.equal(config?.assetType, assetType);
    assert.equal(config?.entityType, 'water_asset');
    assert.ok(config?.fields.some((field) => field.key === 'customFields' && field.kind === 'customFields'));
    assert.ok(config?.fields.some((field) => field.key === 'photos' && field.kind === 'photos'));
  }
});

test('water fixture and system forms contain conditional fields and calculations', () => {
  const fixture = getEquipmentConfig('water-fixtures');
  assert.ok(fixture?.fields.some((field) => field.key === 'flushMechanism'
    && field.condition?.values.includes('Toilets (Pans & Cisterns)')));
  assert.ok(fixture?.fields.some((field) => field.key === 'shutOffValveCondition'
    && field.condition?.values.includes('Pre-Rinse Spray Valve')));

  const system = getEquipmentConfig('water-assets-systems');
  assert.deepEqual(
    system?.fields.find((field) => field.key === 'calculatedCyclesOfConcentration')?.calculation,
    { operation: 'divide', operands: ['basinWaterTdsUsCm', 'makeUpWaterTdsUsCm'], decimalPlaces: 2 },
  );
  assert.deepEqual(
    system?.fields.find((field) => field.key === 'associatedWaterLossKlYear')?.calculation,
    { operation: 'multiply', operands: ['estimatedLeakRateLHr'], factor: 8.76, decimalPlaces: 2 },
  );
});
