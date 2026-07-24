import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePhotoMetadataMap,
  removeIndexedPhotoMetadata,
  setPhotoMetadataName,
} from './photoMetadata';

test('normalizes legacy string captions and canonical metadata objects', () => {
  assert.deepEqual(normalizePhotoMetadataMap({
    aerialPhoto: 'Roof overview',
    msbPhoto: { name: 'Main board', largeInPdf: true },
    empty: {},
  }), {
    aerialPhoto: { name: 'Roof overview' },
    msbPhoto: { name: 'Main board', largeInPdf: true },
  });
});

test('normalizes a legacy JSON-serialized metadata map', () => {
  assert.deepEqual(normalizePhotoMetadataMap(JSON.stringify({
    aerialPhoto: { name: 'Roof overview' },
  })), {
    aerialPhoto: { name: 'Roof overview' },
  });
});

test('updates a caption without dropping existing PDF sizing metadata', () => {
  assert.deepEqual(setPhotoMetadataName({
    aerialPhoto: { name: 'Old name', largeInPdf: true },
  }, 'aerialPhoto', 'New name'), {
    aerialPhoto: { name: 'New name', largeInPdf: true },
  });
});

test('removes one indexed caption and shifts later metadata indexes', () => {
  assert.deepEqual(removeIndexedPhotoMetadata({
    'switchboard.0.photo': { name: 'Remove me' },
    'switchboard.1.photo': { name: 'Keep me', largeInPdf: true },
    aerialPhoto: { name: 'Unrelated' },
  }, 'switchboard', 0), {
    'switchboard.0.photo': { name: 'Keep me', largeInPdf: true },
    aerialPhoto: { name: 'Unrelated' },
  });
});
