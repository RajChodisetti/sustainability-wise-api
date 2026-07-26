import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPhotoIdFromUri, extractPhotoStorageKey } from './photoReferences';

const PHOTO_ID = '9933ea1e-90d5-4a9a-90f8-7b5015f6a51b';

test('extracts legacy hyphen and underscore photo ids', () => {
  assert.equal(extractPhotoIdFromUri(`ecoaudit/audit/photo-${PHOTO_ID}.jpg`), PHOTO_ID);
  assert.equal(extractPhotoIdFromUri(`solarsense/site/photo_${PHOTO_ID}.HEIC?version=1`), PHOTO_ID);
  assert.equal(extractPhotoIdFromUri(`https://cdn.example/photos/photo_${PHOTO_ID}.jpeg#preview`), PHOTO_ID);
});

test('normalizes only safe API photo storage references', () => {
  const key = `ecoaudit/audit name/photo_${PHOTO_ID}.jpg`;
  assert.equal(
    extractPhotoStorageKey(`https://api.example/v1/files/ecoaudit/audit%20name/photo_${PHOTO_ID}.jpg?x=1`),
    key,
  );
  assert.equal(extractPhotoStorageKey(`/v1/thumbnails/${key}`, 'ecoaudit'), key);
  const installHubKey = `installhub/installation/photo_${PHOTO_ID}.jpg`;
  assert.equal(
    extractPhotoStorageKey(`/v1/files/${installHubKey}`, 'installhub'),
    installHubKey,
  );
  assert.equal(extractPhotoStorageKey(key, 'solarsense'), null);
  assert.equal(extractPhotoStorageKey(`ecoaudit/%2e%2e/photo-${PHOTO_ID}.jpg`), null);
  assert.equal(extractPhotoStorageKey(`ecoaudit/audit%2Fescape/photo-${PHOTO_ID}.jpg`), null);
  assert.equal(extractPhotoStorageKey(`other/audit/photo-${PHOTO_ID}.jpg`), null);
});
