import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeEcoAuditSnapshot } from './auditSnapshot.js';

test('removes legacy audit timing keys without changing status data', () => {
  const snapshot = {
    startedAt: 'top-level-camel',
    completed_at: 'top-level-snake',
    audit: {
      id: 'audit-1',
      status: 'Completed',
      startedAt: 'nested-camel',
      completedAt: 'nested-camel',
      started_at: 'nested-snake',
      completed_at: 'nested-snake',
    },
    zones: [{ id: 'zone-1' }],
  };

  assert.deepEqual(sanitizeEcoAuditSnapshot(snapshot), {
    audit: { id: 'audit-1', status: 'Completed' },
    zones: [{ id: 'zone-1' }],
  });
  assert.equal(snapshot.audit.status, 'Completed');
  assert.equal(snapshot.audit.startedAt, 'nested-camel');
});

test('passes non-object snapshots through unchanged', () => {
  assert.equal(sanitizeEcoAuditSnapshot(null), null);
  assert.equal(sanitizeEcoAuditSnapshot('snapshot'), 'snapshot');
});
