import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeVaryHeaderValue } from './httpHeaders';

test('adds Authorization without losing or duplicating upstream Vary fields', () => {
  assert.equal(mergeVaryHeaderValue(null, 'Authorization'), 'Authorization');
  assert.equal(
    mergeVaryHeaderValue('Accept-Encoding, Origin', 'Authorization'),
    'Accept-Encoding, Origin, Authorization',
  );
  assert.equal(
    mergeVaryHeaderValue('accept-encoding, authorization', 'Authorization'),
    'accept-encoding, authorization',
  );
  assert.equal(mergeVaryHeaderValue('*', 'Authorization'), '*');
});
