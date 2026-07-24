import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSyncedPhotoMetadata } from './sync.js';

test('older mobile owner rows preserve newer server photo metadata and updatedAt', () => {
  const serverUpdatedAt = new Date('2026-07-23T16:00:00.000Z');
  const serverPhotoDescs = {
    photo: {
      name: 'Portal caption',
      largeInPdf: true,
    },
  };

  const resolved = resolveSyncedPhotoMetadata({
    updatedAt: new Date('2026-07-23T15:00:00.000Z'),
    photoDescs: {
      photo: {
        name: 'Stale mobile caption',
        largeInPdf: false,
      },
    },
  }, {
    updatedAt: serverUpdatedAt,
    photoDescs: serverPhotoDescs,
  });

  assert.equal(resolved.updatedAt, serverUpdatedAt);
  assert.deepEqual(resolved.photoDescs, serverPhotoDescs);
});

test('newer mobile owner rows replace server photo metadata and updatedAt', () => {
  const mobileUpdatedAt = new Date('2026-07-23T17:00:00.000Z');
  const mobilePhotoDescs = {
    photo: {
      name: 'Latest mobile caption',
      largeInPdf: false,
    },
  };

  const resolved = resolveSyncedPhotoMetadata({
    updatedAt: mobileUpdatedAt,
    photoDescs: mobilePhotoDescs,
  }, {
    updatedAt: new Date('2026-07-23T16:00:00.000Z'),
    photoDescs: {
      photo: {
        name: 'Older portal caption',
        largeInPdf: true,
      },
    },
  });

  assert.equal(resolved.updatedAt, mobileUpdatedAt);
  assert.deepEqual(resolved.photoDescs, mobilePhotoDescs);
});
