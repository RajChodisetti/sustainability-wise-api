import assert from 'node:assert/strict';
import test from 'node:test';
import {
  thumbnailEtagForChecksum,
  thumbnailStorageKeyForChecksum,
  thumbnailUrlForOriginalFileUrl,
} from './thumbnailReference.js';

const CHECKSUM = 'a'.repeat(64);

test('derives a thumbnail URL while preserving the original key and query', () => {
  assert.equal(
    thumbnailUrlForOriginalFileUrl('https://api.example/v1/files/ecoaudit/audit/photo.jpg?version=1'),
    'https://api.example/v1/thumbnails/ecoaudit/audit/photo.jpg?version=1',
  );
  assert.equal(thumbnailUrlForOriginalFileUrl('https://cdn.example/photo.jpg'), null);
  assert.equal(
    thumbnailUrlForOriginalFileUrl('https://cdn.example/photo.jpg?source=/v1/files/not-a-path.jpg'),
    null,
  );
});

test('cache keys and ETags are deterministic and variant-specific', () => {
  const key = thumbnailStorageKeyForChecksum('ecoaudit', CHECKSUM);
  assert.match(
    key,
    /^ecoaudit\/_thumbnails\/v2\/[a-f0-9]{2}\/[a-f0-9]{64}-w400-q52\.jpg$/,
  );
  assert.equal(
    key,
    thumbnailStorageKeyForChecksum('ecoaudit', CHECKSUM.toUpperCase()),
  );
  assert.notEqual(key, thumbnailStorageKeyForChecksum('solarsense', CHECKSUM));
  assert.match(thumbnailEtagForChecksum(CHECKSUM), /^"[a-f0-9]{64}-v2-w400-q52"$/);
});
