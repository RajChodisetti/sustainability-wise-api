import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalEcoAuditPhotoFieldName,
  canonicalizeLightingPhotoMetadata,
  canonicalizeLightingSystemPayload,
  ecoAuditPhotoFieldAliases,
  LIGHTING_CONTROLS_PHOTO_FIELD,
  LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD,
  withLegacyLightingPhotoSyncAlias,
} from './lightingPhotoField.js';

test('uses the mobile lighting controls photo key as the canonical API field', () => {
  assert.equal(
    canonicalEcoAuditPhotoFieldName(LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD),
    LIGHTING_CONTROLS_PHOTO_FIELD,
  );
  assert.deepEqual(ecoAuditPhotoFieldAliases(LIGHTING_CONTROLS_PHOTO_FIELD), [
    LIGHTING_CONTROLS_PHOTO_FIELD,
    LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD,
  ]);
});

test('canonicalizes legacy lighting values and metadata without overriding canonical values', () => {
  assert.deepEqual(canonicalizeLightingSystemPayload({
    switchboardPhotoNotes: 'legacy-photo.jpg',
    photoDescs: { switchboardPhotoNotes: { name: 'Controls', largeInPdf: true } },
  }), {
    switchboardControlsPhoto: 'legacy-photo.jpg',
    photoDescs: { switchboardControlsPhoto: { name: 'Controls', largeInPdf: true } },
  });

  assert.deepEqual(canonicalizeLightingPhotoMetadata({
    switchboardControlsPhoto: { name: 'Canonical' },
    switchboardPhotoNotes: { name: 'Legacy' },
  }), {
    switchboardControlsPhoto: { name: 'Canonical' },
  });
});

test('retains a legacy sync alias only for older installed mobile clients', () => {
  assert.deepEqual(withLegacyLightingPhotoSyncAlias({ switchboardControlsPhoto: 'photo.jpg' }), {
    switchboardControlsPhoto: 'photo.jpg',
    switchboardPhotoNotes: 'photo.jpg',
  });
});
