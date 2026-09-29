import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertWaterAssetCompletedPhotoMetadataReferencesExistingPhotos,
  jsonArray,
  jsonObject,
  isWaterAssetPhotoMetadataOnlyPatch,
  mergeWaterAssetCustomFieldPhotoMetadata,
  requiredWaterAssetType,
  WATER_ASSET_TYPES,
} from './waterAssetContract.js';

test('accepts exactly the four canonical water asset types', () => {
  for (const value of WATER_ASSET_TYPES) {
    assert.equal(requiredWaterAssetType(value), value);
  }
  for (const invalid of ['water_meter_v2', null]) {
    assert.throws(
      () => requiredWaterAssetType(invalid),
      (error: unknown) => (
        error instanceof Error
        && 'statusCode' in error
        && error.statusCode === 400
        && 'detail' in error
        && typeof error.detail === 'string'
        && error.detail.includes('assetType must be one of')
      ),
    );
  }
});

test('completed water assets allow photo metadata edits without business-field changes', () => {
  const existing = [{
    id: 'question-1',
    question: 'Any leak?',
    answer: 'No',
    photos: ['https://example.test/leak.jpg'],
    photoDescs: { 'photos.0': { name: 'Original' } },
  }];
  assert.equal(isWaterAssetPhotoMetadataOnlyPatch(existing, {
    photoDescs: { 'photos.0': { name: 'Overview' } },
    customFields: [{
      id: 'question-1',
      photoDescs: { 'photos.0': { name: 'Under basin', largeInPdf: true } },
    }],
  }), true);
  assert.equal(isWaterAssetPhotoMetadataOnlyPatch(existing, {
    customFields: [{ id: 'question-1', photoDescs: {}, answer: 'Active leak' }],
  }), false);
  assert.equal(isWaterAssetPhotoMetadataOnlyPatch(existing, {
    customFields: [{ id: 'question-1', photoDescs: {}, photos: [] }],
  }), false);
  assert.equal(isWaterAssetPhotoMetadataOnlyPatch(existing, {
    customFields: [{ id: 'question-1', photoDescs: {}, hiddenBusinessValue: 'changed' }],
  }), false);
  assert.equal(isWaterAssetPhotoMetadataOnlyPatch(existing, {
    name: 'Changed tag',
    photoDescs: {},
  }), false);

  assert.deepEqual(mergeWaterAssetCustomFieldPhotoMetadata(existing, [{
    id: 'question-1',
    photoDescs: { 'photos.0': { name: 'Under basin', largeInPdf: true, hiddenContent: 'blocked' } },
  }]), [{
    ...existing[0],
    photoDescs: { 'photos.0': { name: 'Under basin', largeInPdf: true } },
  }]);
  assert.throws(
    () => mergeWaterAssetCustomFieldPhotoMetadata(existing, [{
      id: 'question-1',
      question: 'Changed?',
      photoDescs: {},
    }]),
  );

  assert.doesNotThrow(() => assertWaterAssetCompletedPhotoMetadataReferencesExistingPhotos({
    photos: ['https://example.test/overview.jpg'],
    customFields: existing,
  }, {
    photoDescs: { 'photos.0': { name: 'Overview' } },
    customFields: [{
      id: 'question-1',
      photoDescs: { 'photos.0': { name: 'Under basin' } },
    }],
  }));

  for (const body of [
    { photoDescs: { 'photos.1': { name: 'Missing overview' } } },
    {
      customFields: [{
        id: 'question-1',
        photoDescs: { 'photos.1': { name: 'Missing detail' } },
      }],
    },
  ]) {
    assert.throws(() => assertWaterAssetCompletedPhotoMetadataReferencesExistingPhotos({
      photos: ['https://example.test/overview.jpg'],
      customFields: existing,
    }, body));
  }
});

test('legacy custom questions use their stable positional identity for metadata-only patches', () => {
  const existing = [{ question: 'Condition?', answer: 'Good', photos: ['https://example.test/a.jpg'] }];
  const patch = [{ id: 'custom-1', photoDescs: { 'photos.0': { name: 'Condition photo' } } }];
  assert.equal(isWaterAssetPhotoMetadataOnlyPatch(existing, { customFields: patch }), true);
  assert.deepEqual(mergeWaterAssetCustomFieldPhotoMetadata(existing, patch), [{
    ...existing[0],
    photoDescs: { 'photos.0': { name: 'Condition photo' } },
  }]);
});

test('normalizes water asset JSON containers without flattening nested fields', () => {
  const fields = [{ id: 'one', question: 'Condition?', answer: 'Good', photos: ['photo://one'] }];
  const data = { meterSizeMm: 50, connectedToBms: 'Yes' };
  assert.equal(jsonArray(fields), fields);
  assert.equal(jsonObject(data), data);
  assert.deepEqual(jsonArray({}), []);
  assert.deepEqual(jsonObject([]), {});
});
