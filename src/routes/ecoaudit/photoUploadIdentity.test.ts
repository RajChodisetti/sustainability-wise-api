import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ??= 'photo-upload-identity-test-secret';
process.env.JWT_REFRESH_SECRET ??= 'photo-upload-identity-refresh-test-secret';

const { photoUploadIdentityKey } = await import('./sync.js');

test('photo upload identity is stable for one exact audit record field and checksum', () => {
  const input = {
    auditId: 'audit-1',
    entityId: 'switchboard-1',
    fieldName: 'extraPhotos[2]',
    checksum: 'abc123',
  };
  assert.equal(photoUploadIdentityKey(input), photoUploadIdentityKey({ ...input }));
});

test('photo upload identity remains scoped to each field and checksum', () => {
  const input = {
    auditId: 'audit-1',
    entityId: 'switchboard-1',
    fieldName: 'extraPhotos[2]',
    checksum: 'abc123',
  };
  assert.notEqual(photoUploadIdentityKey(input), photoUploadIdentityKey({ ...input, fieldName: 'extraPhotos[3]' }));
  assert.notEqual(photoUploadIdentityKey(input), photoUploadIdentityKey({ ...input, checksum: 'def456' }));
});
