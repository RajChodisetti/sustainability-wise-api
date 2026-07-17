import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneRecordForInsert, copyableBodyOverrides } from './copyUtils.js';

test('copy helpers never inherit or accept identity and lifecycle metadata', () => {
  const source = {
    id: 'source',
    serverId: 'server-source',
    siteName: 'Site',
    createdByUserId: 'creator',
    createdAt: new Date('2026-01-01T01:00:00.000Z'),
  };

  const overrides = copyableBodyOverrides(source, {
    siteName: 'Requested name',
    serverId: 'requested-server',
    createdByUserId: 'requested-creator',
    createdAt: new Date('2026-02-01T01:00:00.000Z'),
  });
  const copied = cloneRecordForInsert(source, overrides);

  assert.equal(overrides.siteName, 'Requested name');
  assert.equal('serverId' in overrides, false);
  assert.equal('createdByUserId' in overrides, false);
  assert.equal('createdAt' in overrides, false);
  assert.notEqual(copied.id, source.id);
  assert.notEqual(copied.serverId, source.serverId);
  assert.notEqual(copied.createdAt, source.createdAt);
});

test('explicit allowed overrides support top-level audit copy reset', () => {
  const copied = cloneRecordForInsert({
    id: 'source',
    status: 'Completed',
    siteName: 'Original site',
  }, {
    status: 'Draft',
    siteName: 'Copied site',
  });

  assert.equal(copied.status, 'Draft');
  assert.equal(copied.siteName, 'Copied site');
});
