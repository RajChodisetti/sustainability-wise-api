import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function assertOrdered(document: string, markers: string[], after = 0): void {
  let cursor = after;
  for (const marker of markers) {
    const index = document.indexOf(marker, cursor);
    assert.notEqual(index, -1, `Expected source marker after offset ${cursor}: ${marker}`);
    cursor = index + marker.length;
  }
}

const newAuditPage = source('../app/(portal)/ecoaudit/(app)/audits/new/page.tsx');
const auditDetailPage = source('../app/(portal)/ecoaudit/(app)/audits/[auditId]/page.tsx');

test('create and copy navigation happens only after lease storage and command clearance', () => {
  assert.match(newAuditPage, /getPendingAuditCreateCommand\(actorUserId\)/);
  assertOrdered(newAuditPage, [
    'beginPendingAuditCreateCommand({',
    'await executeCreateCommand(command)',
  ]);
  assertOrdered(newAuditPage, [
    'const result = await createAudit(command)',
    'const leaseStored = storeAuditLeaseDurably({',
    'clearPendingAuditCommand(command)',
    'router.push(`/ecoaudit/audits/${result.audit.id}`)',
  ]);

  assert.match(auditDetailPage, /getPendingAuditCopyCommand\(auditId, actorUserId\)/);
  assertOrdered(auditDetailPage, [
    'const result = await createAuditAmendment(command)',
    'const leaseStored = storeAuditLeaseDurably({',
    'clearPendingAuditCommand(command)',
    'router.push(`/ecoaudit/audits/${result.audit.id}`)',
  ]);
});

test('lease acquire reload replay preserves its command until proof is stored and accepted', () => {
  assert.match(auditDetailPage, /getPendingAuditAcquireCommand\(auditId, actorUserId\)/);
  assertOrdered(auditDetailPage, [
    'const result = await acquireAuditEditLease(command)',
    'const leaseStored = storeAuditLeaseDurably({',
    'acceptAuthorityRevision(result.treeRevision)',
    'clearPendingAuditCommand(command)',
  ]);
  assertOrdered(auditDetailPage, [
    'const command = beginPendingAuditAcquireCommand({',
    'await executeAcquireCommand(command)',
  ]);
});

test('durable commands are resumed only for their authenticated actor', () => {
  assert.match(newAuditPage, /const \{ user \} = useAuth\(\)/);
  assert.match(newAuditPage, /activeActorUserId\.current !== command\.actorUserId/);
  assert.match(newAuditPage, /inFlightCommandId\.current === command\.idempotencyKey/);
  assert.match(newAuditPage, /getPendingAuditCreateCommand\(actorUserId\)/);
  assert.match(auditDetailPage, /const \{ user \} = useAuth\(\)/);
  assert.match(auditDetailPage, /durableInFlightCommandId\.current !== null/);
  assert.match(auditDetailPage, /getPendingAuditCopyCommand\(auditId, actorUserId\)/);
  assert.match(auditDetailPage, /getPendingAuditAcquireCommand\(auditId, actorUserId\)/);
});

test('audit-tree mutations accept their own revision before navigating', () => {
  const cases = [
    {
      file: '../app/(portal)/ecoaudit/(app)/audits/[auditId]/edit/page.tsx',
      mutation: 'await updateAudit(',
      accept: 'await onMutationAccepted()',
    },
    {
      file: '../app/(portal)/ecoaudit/(app)/audits/[auditId]/zones/new/page.tsx',
      mutation: 'await createZone(',
      accept: 'await authority.refreshAndAccept()',
    },
    {
      file: '../app/(portal)/ecoaudit/(app)/audits/[auditId]/zones/[zoneId]/edit/page.tsx',
      mutation: 'await updateZone(',
      accept: 'await onMutationAccepted()',
    },
    {
      file: '../app/(portal)/ecoaudit/(app)/audits/[auditId]/zones/[zoneId]/edit/page.tsx',
      mutation: 'await deleteZone(',
      accept: 'await onMutationAccepted()',
    },
    {
      file: '../app/(portal)/ecoaudit/(app)/audits/[auditId]/equipment/[type]/new/page.tsx',
      mutation: 'await createEquipment(',
      accept: 'await authority.refreshAndAccept()',
    },
    {
      file: '../app/(portal)/ecoaudit/(app)/audits/[auditId]/equipment/[type]/[itemId]/edit/page.tsx',
      mutation: 'await updateEquipment(',
      accept: 'await onMutationAccepted()',
    },
    {
      file: '../app/(portal)/ecoaudit/(app)/audits/[auditId]/equipment/[type]/[itemId]/edit/page.tsx',
      mutation: 'await deleteEquipment(',
      accept: 'await onMutationAccepted()',
    },
  ];

  for (const item of cases) {
    const document = source(item.file);
    const mutationIndex = document.indexOf(item.mutation);
    assert.notEqual(mutationIndex, -1, `Missing mutation in ${item.file}: ${item.mutation}`);
    assertOrdered(document, [item.accept, 'router.push('], mutationIndex);
  }
});
