import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../utils/errors.js';
import { assertEcoAuditPhotoIsUnreferenced } from './photos.js';

test('direct photo deletion rejects a photo still referenced by the current audit', () => {
  assert.throws(
    () => assertEcoAuditPhotoIsUnreferenced(
      [{ id: 'photo-current' }, { id: 'photo-other' }],
      'photo-current',
    ),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'Photo is still referenced by the current audit',
  );
  assert.doesNotThrow(() => assertEcoAuditPhotoIsUnreferenced(
    [{ id: 'photo-current' }],
    'photo-staged-or-orphaned',
  ));
});
