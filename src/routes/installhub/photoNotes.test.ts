import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanonicalInputError,
  parsePhotoNotes,
  type CanonicalInstallationTree,
} from './canonical.js';
import { retainOmittedPhotoNotes } from './sync.js';

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

test('an older full-tree client cannot erase photo notes it omits', () => {
  const current = {
    zones: [{ id: 'zone', photoNotes: { 'photos[0]': 'Plant room' } }],
    electricalAssets: [{ id: 'board', photoNotes: { photo: 'Main board' } }],
    siteAssets: [{ id: 'asset', photoNotes: { locationPhoto: 'Roof' } }],
    meterDevices: [{ id: 'meter', photoNotes: { 'wwPhotos.labeling': 'Labels' } }],
  } as unknown as CanonicalInstallationTree;
  const incoming = {
    zones: [{ id: 'zone' }],
    electricalAssets: [{ id: 'board' }],
    siteAssets: [{ id: 'asset' }],
    meterDevices: [{ id: 'meter' }],
  } as unknown as CanonicalInstallationTree;

  retainOmittedPhotoNotes(current, incoming);

  assert.deepEqual(incoming.zones[0].photoNotes, current.zones[0].photoNotes);
  assert.deepEqual(incoming.electricalAssets[0].photoNotes, current.electricalAssets[0].photoNotes);
  assert.deepEqual(incoming.siteAssets[0].photoNotes, current.siteAssets[0].photoNotes);
  assert.deepEqual(incoming.meterDevices[0].photoNotes, current.meterDevices[0].photoNotes);
});
