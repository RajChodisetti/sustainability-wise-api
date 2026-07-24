import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  deleteLocalFile,
  localFileBuffer,
  storageAppFromKey,
  writeLocalFile,
} from './localFiles.js';

test('storage keys resolve to exactly one application namespace', () => {
  assert.equal(storageAppFromKey('ecoaudit/audit/photo.jpg'), 'ecoaudit');
  assert.equal(storageAppFromKey('solarsense/site/photo.jpg'), 'solarsense');
  assert.equal(storageAppFromKey('installhub/install/photo.jpg'), 'installhub');
  assert.equal(storageAppFromKey('_thumbnails/v1/shared.jpg'), null);
});

test('an exact storage write retry is idempotent but changed bytes are rejected', async () => {
  const storageKey = `installhub/storage-test/report-${randomUUID()}.pdf`;
  const body = Buffer.from('same report bytes');
  try {
    await writeLocalFile(storageKey, body);
    await writeLocalFile(storageKey, body);
    assert.deepEqual(await localFileBuffer(storageKey), body);
    await assert.rejects(
      () => writeLocalFile(storageKey, Buffer.from('different report bytes')),
      /different content|EEXIST/,
    );
  } finally {
    await deleteLocalFile(storageKey);
  }
});
