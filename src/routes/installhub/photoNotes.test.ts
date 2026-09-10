import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanonicalInputError,
  parsePhotoMetadata,
  parsePhotoNotes,
  type CanonicalInstallationTree,
} from './canonical.js';
import {
  retainOmittedAttachmentPdfSizing,
  retainOmittedPhotoMetadata,
  retainOmittedPhotoNotes,
} from './sync.js';

test('canonical photo notes trim text and enforce the 500 character boundary', () => {
  assert.deepEqual(parsePhotoNotes({ photo: '  Front of board  ', empty: ' ' }, 'photoNotes'), {
    photo: 'Front of board',
  });
  assert.throws(
    () => parsePhotoNotes({ photo: 'x'.repeat(501) }, 'photoNotes'),
    CanonicalInputError,
  );
  assert.throws(() => parsePhotoNotes({ photo: 123 }, 'photoNotes'), CanonicalInputError);
});

test('canonical photo metadata preserves explicit false and rejects unknown values', () => {
  assert.deepEqual(parsePhotoMetadata({
    'photos[0]': { largeInPdf: true },
    'photos[1]': { largeInPdf: false },
  }, 'photoMetadata'), {
    'photos[0]': { largeInPdf: true },
    'photos[1]': { largeInPdf: false },
  });
  assert.throws(
    () => parsePhotoMetadata({ photo: { largeInPdf: 'yes' } }, 'photoMetadata'),
    CanonicalInputError,
  );
  assert.throws(
    () => parsePhotoMetadata({ photo: { largeInPdf: true, crop: true } }, 'photoMetadata'),
    CanonicalInputError,
  );
});

test('an older full-tree client cannot erase photo notes it omits', () => {
  const current = {
    zones: [{ id: 'zone', photos: ['photo-zone'], photoNotes: { 'photos[0]': 'Plant room' } }],
    electricalAssets: [{ id: 'board', photo: 'photo-board', extraPhotos: [], photoNotes: { photo: 'Main board' } }],
    siteAssets: [{ id: 'asset', locationPhoto: 'photo-asset', extraPhotos: [], photoNotes: { locationPhoto: 'Roof' } }],
    meterDevices: [{ id: 'meter', wwPhotos: { labeling: 'photo-meter' }, photoNotes: { 'wwPhotos.labeling': 'Labels' } }],
    formSubmissions: [],
  } as unknown as CanonicalInstallationTree;
  const incoming = {
    zones: [{ id: 'zone', photos: ['photo-zone'] }],
    electricalAssets: [{ id: 'board', photo: 'photo-board', extraPhotos: [] }],
    siteAssets: [{ id: 'asset', locationPhoto: 'photo-asset', extraPhotos: [] }],
    meterDevices: [{ id: 'meter', wwPhotos: { labeling: 'photo-meter' } }],
    formSubmissions: [],
  } as unknown as CanonicalInstallationTree;

  retainOmittedPhotoNotes(current, incoming);

  assert.deepEqual(incoming.zones[0].photoNotes, current.zones[0].photoNotes);
  assert.deepEqual(incoming.electricalAssets[0].photoNotes, current.electricalAssets[0].photoNotes);
  assert.deepEqual(incoming.siteAssets[0].photoNotes, current.siteAssets[0].photoNotes);
  assert.deepEqual(incoming.meterDevices[0].photoNotes, current.meterDevices[0].photoNotes);
});

test('older clients retain omitted entity and attachment PDF sizing while explicit false clears it', () => {
  const current = {
    zones: [{ id: 'zone', photos: ['photo-zone'], photoMetadata: { 'photos[0]': { largeInPdf: true } } }],
    electricalAssets: [{ id: 'board', photo: 'photo-board', extraPhotos: [], photoMetadata: { photo: { largeInPdf: true } } }],
    siteAssets: [{ id: 'asset', locationPhoto: 'photo-asset', extraPhotos: [], photoMetadata: { locationPhoto: { largeInPdf: true } } }],
    meterDevices: [{ id: 'meter', wwPhotos: { labeling: 'photo-meter' }, photoMetadata: { 'wwPhotos.labeling': { largeInPdf: true } } }],
    formSubmissions: [{
      id: 'form',
      attachments: [{ id: 'attachment', largeInPdf: true }],
    }],
  } as unknown as CanonicalInstallationTree;
  const incoming = {
    zones: [{ id: 'zone', photos: ['photo-zone'] }],
    electricalAssets: [{ id: 'board', photo: 'photo-board', extraPhotos: [], photoMetadata: { photo: { largeInPdf: false } } }],
    siteAssets: [{ id: 'asset', locationPhoto: 'photo-asset', extraPhotos: [] }],
    meterDevices: [{ id: 'meter', wwPhotos: { labeling: 'photo-meter' } }],
    formSubmissions: [{
      id: 'form',
      attachments: [
        { id: 'attachment' },
        { id: 'new-attachment', largeInPdf: false },
      ],
    }],
  } as unknown as CanonicalInstallationTree;

  retainOmittedPhotoMetadata(current, incoming);
  retainOmittedAttachmentPdfSizing(current, incoming);

  assert.deepEqual(incoming.zones[0].photoMetadata, current.zones[0].photoMetadata);
  assert.deepEqual(incoming.electricalAssets[0].photoMetadata, {
    photo: { largeInPdf: false },
  });
  assert.deepEqual(incoming.siteAssets[0].photoMetadata, current.siteAssets[0].photoMetadata);
  assert.deepEqual(incoming.meterDevices[0].photoMetadata, current.meterDevices[0].photoMetadata);
  assert.equal(
    (incoming.formSubmissions[0].attachments[0] as Record<string, unknown>).largeInPdf,
    true,
  );
  assert.equal(
    (incoming.formSubmissions[0].attachments[1] as Record<string, unknown>).largeInPdf,
    false,
  );
});

test('legacy deletion and reorder retain captions and sizing by immutable photo identity', () => {
  const parent = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const photoA = `https://files.example/${parent}/11111111-1111-4111-8111-111111111111.jpg`;
  const photoB = `https://files.example/${parent}/22222222-2222-4222-8222-222222222222.jpg`;
  const current = {
    zones: [{
      id: 'zone',
      photos: [photoA, photoB],
      photoNotes: { 'photos[0]': 'A', 'photos[1]': 'B' },
      photoMetadata: {
        'photos[0]': { largeInPdf: true },
        'photos[1]': { largeInPdf: false },
      },
    }],
    electricalAssets: [{
      id: 'board',
      extraPhotos: [photoA, photoB],
      photoNotes: { 'extraPhotos[0]': 'A', 'extraPhotos[1]': 'B' },
      photoMetadata: {
        'extraPhotos[0]': { largeInPdf: true },
        'extraPhotos[1]': { largeInPdf: false },
      },
    }],
    siteAssets: [],
    meterDevices: [],
    formSubmissions: [],
  } as unknown as CanonicalInstallationTree;
  const incoming = {
    zones: [{ id: 'zone', photos: [photoB] }],
    electricalAssets: [{ id: 'board', extraPhotos: [photoB, photoA] }],
    siteAssets: [],
    meterDevices: [],
    formSubmissions: [],
  } as unknown as CanonicalInstallationTree;

  retainOmittedPhotoNotes(current, incoming);
  retainOmittedPhotoMetadata(current, incoming);

  assert.deepEqual(incoming.zones[0].photoNotes, { 'photos[0]': 'B' });
  assert.deepEqual(incoming.zones[0].photoMetadata, {
    'photos[0]': { largeInPdf: false },
  });
  assert.deepEqual(incoming.electricalAssets[0].photoNotes, {
    'extraPhotos[0]': 'B',
    'extraPhotos[1]': 'A',
  });
  assert.deepEqual(incoming.electricalAssets[0].photoMetadata, {
    'extraPhotos[0]': { largeInPdf: false },
    'extraPhotos[1]': { largeInPdf: true },
  });
});

test('legacy retention drops ambiguous duplicate photo identities instead of misbinding metadata', () => {
  const photo = 'https://files.example/11111111-1111-4111-8111-111111111111.jpg';
  const current = {
    zones: [{
      id: 'zone',
      photos: [photo, photo],
      photoNotes: { 'photos[0]': 'First', 'photos[1]': 'Second' },
      photoMetadata: {
        'photos[0]': { largeInPdf: true },
        'photos[1]': { largeInPdf: false },
      },
    }],
    electricalAssets: [],
    siteAssets: [],
    meterDevices: [],
    formSubmissions: [],
  } as unknown as CanonicalInstallationTree;
  const incoming = {
    zones: [{ id: 'zone', photos: [photo] }],
    electricalAssets: [],
    siteAssets: [],
    meterDevices: [],
    formSubmissions: [],
  } as unknown as CanonicalInstallationTree;

  retainOmittedPhotoNotes(current, incoming);
  retainOmittedPhotoMetadata(current, incoming);

  assert.deepEqual(incoming.zones[0].photoNotes, {});
  assert.deepEqual(incoming.zones[0].photoMetadata, {});
});
