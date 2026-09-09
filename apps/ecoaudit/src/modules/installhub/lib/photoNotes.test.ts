import assert from 'node:assert/strict';
import test from 'node:test';
import { removeIndexedPhotoNote, setPhotoNote } from './photoNotes';

test('sets, trims, and clears a photo note without changing other entries', () => {
  assert.deepEqual(setPhotoNote({ photo: 'Front', other: 'Keep' }, 'photo', '  Updated  '), {
    photo: 'Updated', other: 'Keep',
  });
  assert.deepEqual(setPhotoNote({ photo: 'Front', other: 'Keep' }, 'photo', '  '), {
    other: 'Keep',
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
