import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneRecordForInsert, copyableBodyOverrides } from './copyUtils.js';

test('copy helpers never inherit or accept audit timing metadata', () => {
  const source = {
    id: 'source',
    siteName: 'Site',
    startedAt: new Date('2026-01-01T01:00:00.000Z'),
    completedAt: new Date('2026-01-01T02:00:00.000Z'),
  };

  const overrides = copyableBodyOverrides(source, {
    siteName: 'Requested name',
    startedAt: new Date('2026-02-01T01:00:00.000Z'),
    completedAt: new Date('2026-02-01T02:00:00.000Z'),
  });
  const copied = cloneRecordForInsert(source, overrides);

  assert.equal(overrides.siteName, 'Requested name');
  assert.equal('startedAt' in overrides, false);
  assert.equal('completedAt' in overrides, false);
  assert.equal('startedAt' in copied, false);
  assert.equal('completedAt' in copied, false);
});

test('explicit null timing overrides support top-level audit copy reset', () => {
  const copied = cloneRecordForInsert({
    id: 'source',
    startedAt: new Date('2026-01-01T01:00:00.000Z'),
    completedAt: new Date('2026-01-01T02:00:00.000Z'),
  }, {
    startedAt: null,
    completedAt: null,
  });

  assert.equal(copied.startedAt, null);
  assert.equal(copied.completedAt, null);
});
