import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../utils/errors.js';
import { assertCompletedPhotoMetadataReferencesExistingPhotos } from './completedPhotoMetadata.js';

const record = {
  name: 'Not a photo field',
  photo: 'https://example.test/primary.jpg',
  extraPhotos: [
    'https://example.test/extra-1.jpg',
    'https://example.test/extra-2.jpg',
  ],
  emptyPhoto: null,
};

test('completed photo metadata accepts only present scalar photos and exact array indices', () => {
  assert.doesNotThrow(() => assertCompletedPhotoMetadataReferencesExistingPhotos(record, {
    photo: { name: 'Primary' },
    'extraPhotos.0': { name: 'First extra' },
    'extraPhotos.1': { largeInPdf: true },
  }));
  assert.doesNotThrow(() => assertCompletedPhotoMetadataReferencesExistingPhotos(record, {}));
});

test('completed photo metadata rejects orphan, malformed, and non-photo keys', () => {
  for (const key of [
    'missingPhoto',
    'emptyPhoto',
    'extraPhotos',
    'extraPhotos.2',
    'extraPhotos[0]',
    'name',
  ]) {
    assert.throws(
      () => assertCompletedPhotoMetadataReferencesExistingPhotos(record, {
        [key]: { name: 'Blocked' },
      }),
      (error) => error instanceof AppError
        && error.statusCode === 400
        && error.detail === `photoDescs.${key} does not reference an existing photo`,
    );
  }
});

test('completed photo metadata requires an object map', () => {
  for (const value of [null, [], 'photo']) {
    assert.throws(
      () => assertCompletedPhotoMetadataReferencesExistingPhotos(record, value),
      (error) => error instanceof AppError
        && error.statusCode === 400
        && error.detail === 'photoDescs must be an object',
    );
  }
});
