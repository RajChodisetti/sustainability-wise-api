import assert from 'node:assert/strict';
import test from 'node:test';
import {
  photoLargeInPdf,
  planPrimaryAndAdditionalPhotoFields,
  removeIndexedPhotoMetadata,
  removeIndexedPhotoNote,
  removePhotoMetadata,
  setPhotoLargeInPdf,
  setPhotoNote,
} from './photoNotes';

test('primary evidence accepts several selected photos and routes overflow to additional fields', () => {
  assert.deepEqual(planPrimaryAndAdditionalPhotoFields({
    primaryField: 'locationPhoto',
    primaryOccupied: false,
    additionalFieldPrefix: 'extraPhotos',
    existingAdditionalCount: 2,
    fileCount: 3,
  }), ['locationPhoto', 'extraPhotos[2]', 'extraPhotos[3]']);
  assert.deepEqual(planPrimaryAndAdditionalPhotoFields({
    primaryField: 'wwPhotos.deviceInstalled',
    primaryOccupied: true,
    additionalFieldPrefix: 'wwPhotos.extra',
    existingAdditionalCount: 1,
    fileCount: 2,
  }), ['wwPhotos.extra[1]', 'wwPhotos.extra[2]']);
});

test('sets, trims, and clears a photo note without changing other entries', () => {
  assert.deepEqual(setPhotoNote({ photo: 'Front', other: 'Keep' }, 'photo', '  Updated  '), {
    photo: 'Updated', other: 'Keep',
  });
  assert.deepEqual(setPhotoNote({ photo: 'Front', other: 'Keep' }, 'photo', '  '), {
    other: 'Keep',
  });
});

test('removing a scalar photo also removes its PDF sizing metadata', () => {
  assert.deepEqual(removePhotoMetadata({
    photo: { largeInPdf: true },
    other: { largeInPdf: false },
  }, 'photo'), {
    other: { largeInPdf: false },
  });
});

test('removing an array photo reindexes only notes for that photo field', () => {
  assert.deepEqual(removeIndexedPhotoNote({
    'extraPhotos[0]': 'First',
    'extraPhotos[1]': 'Removed',
    'extraPhotos[2]': 'Third',
    photo: 'Main',
  }, 'extraPhotos', 1), {
    'extraPhotos[0]': 'First',
    'extraPhotos[1]': 'Third',
    photo: 'Main',
  });
});

test('photo PDF sizing keeps explicit true and false intent on exact InstallHub upload keys', () => {
  const selected = setPhotoLargeInPdf({}, 'extraPhotos[1]', true);
  assert.equal(photoLargeInPdf(selected, 'extraPhotos[1]'), true);
  assert.deepEqual(setPhotoLargeInPdf(selected, 'extraPhotos[1]', false), {
    'extraPhotos[1]': { largeInPdf: false },
  });
});

test('removing an indexed photo rekeys its PDF sizing metadata', () => {
  assert.deepEqual(removeIndexedPhotoMetadata({
    photo: { largeInPdf: true },
    'extraPhotos[0]': { largeInPdf: true },
    'extraPhotos[1]': { largeInPdf: true },
    'extraPhotos[2]': { largeInPdf: true },
  }, 'extraPhotos', 1), {
    photo: { largeInPdf: true },
    'extraPhotos[0]': { largeInPdf: true },
    'extraPhotos[1]': { largeInPdf: true },
  });
});
