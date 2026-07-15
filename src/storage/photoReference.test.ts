import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePhotoReference,
  resolvePhotoReferenceWithLookup,
  type PhotoReferenceCandidate,
} from './photoReference.js';

const PHOTO_ID = '9933ea1e-90d5-4a9a-90f8-7b5015f6a51b';
const PARENT_ID = 'c2a04136-0b9f-45f2-9343-4d7a4720be0e';
const LEGACY_KEY = [
  'ecoaudit',
  PARENT_ID,
  'additional_switchboard',
  '38634d42-bef9-4a62-afa8-fdaa4019f4f6',
  'extraphotos-0',
  `extraphotos-0-${PHOTO_ID}.jpg`,
].join('/');
const CURRENT_KEY = [
  'ecoaudit',
  'nsw-tafe---haymarket',
  'additional_switchboard',
  'distribution-boards',
  'extraphotos-0',
  `extraphotos-0-${PHOTO_ID}.jpg`,
].join('/');

function candidate(overrides: Partial<PhotoReferenceCandidate> = {}): PhotoReferenceCandidate {
  return {
    id: PHOTO_ID,
    app: 'ecoaudit',
    parentId: PARENT_ID,
    storageKey: CURRENT_KEY,
    status: 'confirmed',
    ...overrides,
  };
}

test('extracts immutable photo and parent ids from a legacy storage key', () => {
  assert.deepEqual(parsePhotoReference(LEGACY_KEY), {
    app: 'ecoaudit',
    photoId: PHOTO_ID,
    legacyParentId: PARENT_ID,
  });
  assert.deepEqual(parsePhotoReference(CURRENT_KEY), {
    app: 'ecoaudit',
    photoId: PHOTO_ID,
    legacyParentId: null,
  });
  assert.equal(parsePhotoReference(`ecoaudit/${PARENT_ID}/../photo-${PHOTO_ID}.jpg`), null);
  assert.equal(parsePhotoReference(`other/${PARENT_ID}/photo-${PHOTO_ID}.jpg`), null);
  assert.equal(parsePhotoReference(`ecoaudit/${PARENT_ID}/photo-without-an-id.jpg`), null);
  assert.deepEqual(
    parsePhotoReference(`solarsense/${PARENT_ID}/site/photo-${PHOTO_ID}.heic`),
    { app: 'solarsense', photoId: PHOTO_ID, legacyParentId: PARENT_ID },
  );
});

test('uses an exact current registry reference without invoking legacy lookup', async () => {
  let identityLookups = 0;
  const row = candidate();
  const resolved = await resolvePhotoReferenceWithLookup(CURRENT_KEY, 'ecoaudit', {
    byStorageKey: async () => row,
    byIdentity: async () => {
      identityLookups += 1;
      return null;
    },
  });

  assert.equal(resolved, row);
  assert.equal(identityLookups, 0);
});

test('resolves a renamed photo from its legacy filename identity', async () => {
  const calls: string[] = [];
  const resolved = await resolvePhotoReferenceWithLookup(LEGACY_KEY, 'ecoaudit', {
    byStorageKey: async () => {
      calls.push('exact');
      return null;
    },
    byIdentity: async (identity) => {
      calls.push(`${identity.app}:${identity.photoId}:${identity.legacyParentId}`);
      return candidate();
    },
  });

  assert.equal(resolved?.storageKey, CURRENT_KEY);
  assert.deepEqual(calls, ['exact', `ecoaudit:${PHOTO_ID}:${PARENT_ID}`]);
});

test('does not resolve a legacy identity across app or parent boundaries', async () => {
  let lookups = 0;
  const lookup = {
    byStorageKey: async () => {
      lookups += 1;
      return null;
    },
    byIdentity: async () => {
      lookups += 1;
      return candidate({ parentId: '11111111-1111-4111-8111-111111111111' });
    },
  };

  assert.equal(await resolvePhotoReferenceWithLookup(LEGACY_KEY, 'solarsense', lookup), null);
  assert.equal(lookups, 0);
  assert.equal(await resolvePhotoReferenceWithLookup(LEGACY_KEY, 'ecoaudit', lookup), null);
  assert.equal(lookups, 2);
});

test('rejects non-confirmed and missing-storage registry rows', async () => {
  for (const row of [candidate({ status: 'uploaded' }), candidate({ storageKey: null })]) {
    const resolved = await resolvePhotoReferenceWithLookup(LEGACY_KEY, 'ecoaudit', {
      byStorageKey: async () => null,
      byIdentity: async () => row,
    });
    assert.equal(resolved, null);
  }
});
