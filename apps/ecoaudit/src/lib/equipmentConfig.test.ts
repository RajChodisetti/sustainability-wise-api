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
