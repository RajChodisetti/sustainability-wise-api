import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePhotoMetadata,
  normalizePhotoDescsRecord,
  normalizePhotoMetadataMap,
  photoMetadataKeyFromUploadField,
  setPhotoMetadata,
} from './photoMetadata';

test('canonicalizes app upload photo fields to PDF metadata keys', () => {
  assert.equal(photoMetadataKeyFromUploadField('extraPhotos[2]'), 'extraPhotos.2');
  assert.equal(photoMetadataKeyFromUploadField('extra_photos_2'), 'extraPhotos.2');
  assert.equal(photoMetadataKeyFromUploadField('switchboardPhotoNotes'), 'switchboardControlsPhoto');
  assert.equal(photoMetadataKeyFromUploadField('switchboard_photo_notes'), 'switchboardControlsPhoto');
});

test('merges legacy and canonical photo metadata into photoDescs', () => {
  assert.deepEqual(
    normalizePhotoDescsRecord({
      photo_descs: {
        extra_photos_0: 'Legacy extra',
        switchboardPhotoNotes: { largeInPdf: true },
      },
      photoDescs: {
        'extraPhotos.0': { name: 'Canonical extra' },
        switchboardControlsPhoto: { name: 'Controls' },
      },
    }),
    {
      'extraPhotos.0': { name: 'Canonical extra' },
      switchboardControlsPhoto: { largeInPdf: true, name: 'Controls' },
    },
  );
});

test('normalizes duplicate photo metadata keys without keeping aliases', () => {
  assert.deepEqual(
    normalizePhotoMetadataMap({
      'photos[1]': { name: 'From upload' },
      photos_1: { largeInPdf: true },
      'photos.1': { name: 'From PDF key' },
    }),
    {
      'photos.1': { name: 'From PDF key', largeInPdf: true },
    },
  );
});

test('preserves mobile PDF sizing through a portal caption edit, normalized save, and reload', () => {
  const loadedFromMobile = normalizePhotoDescsRecord({
    photoDescs: {
      'extraPhotos.0': { name: 'Mobile caption', largeInPdf: true },
    },
  });
  const current = normalizePhotoMetadata(loadedFromMobile['extraPhotos.0']);
  const portalEdit = setPhotoMetadata(
    loadedFromMobile,
    'extraPhotos[0]',
    { ...current, name: 'Portal caption' },
  );
  const saved = normalizePhotoMetadataMap(portalEdit);
  const reloaded = normalizePhotoDescsRecord({ photoDescs: saved });

  assert.deepEqual(reloaded, {
    'extraPhotos.0': { name: 'Portal caption', largeInPdf: true },
  });
});
