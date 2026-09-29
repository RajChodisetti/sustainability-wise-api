import assert from 'node:assert/strict';
import test from 'node:test';
import { withEcoAuditTreeRevision } from './auditMutation.js';

test('child mutation responses carry the exact accepted aggregate revision', () => {
  const child = { id: 'zone-1', zoneName: 'Kitchen' };
  const response = withEcoAuditTreeRevision(child, 21);
  assert.deepEqual(response, { ...child, treeRevision: 21 });
  assert.equal('treeRevision' in child, false);
});
