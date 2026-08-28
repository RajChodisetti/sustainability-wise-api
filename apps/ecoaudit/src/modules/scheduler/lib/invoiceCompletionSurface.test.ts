import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const invoiceWorkspace = readFileSync(
  new URL('../components/InvoiceWorkspace.tsx', import.meta.url),
  'utf8',
);
const invoiceRegister = readFileSync(
  new URL('../components/SchedulerInvoicesWorkspace.tsx', import.meta.url),
  'utf8',
);
const schedulerHooks = readFileSync(
  new URL('../hooks/useScheduler.ts', import.meta.url),
  'utf8',
);

test('invoice surfaces let admins complete incomplete Field App jobs in place', () => {
  assert.match(invoiceWorkspace, /export function InvoiceJobCompletionAction/);
  assert.match(invoiceWorkspace, /Mark job complete/);
  assert.match(invoiceWorkspace, /This closes the Field App job and linked Scheduler work/);
  assert.match(invoiceWorkspace, /await complete\.mutateAsync\(\{/);
  assert.match(invoiceWorkspace, /completionIdempotencyKeyRef\.current = idempotencyKey/);
  assert.match(invoiceWorkspace, /complete\.isPending \? 'Completing…'/);
  assert.match(invoiceWorkspace, /incompleteJobs\.map\(\(job\) =>/);
  assert.match(invoiceWorkspace, /onCompleted=\{onRefresh\}/);

  assert.match(invoiceRegister, /<InvoiceJobCompletionAction/);
  assert.match(invoiceRegister, /!completed && job\.sourceApp === 'installhub'/);
  assert.match(invoiceRegister, /job\.sourceType === 'installation'/);
  assert.match(invoiceRegister, /Complete this job before invoicing/);
});

test('job completion invalidates the Scheduler cache after success', () => {
  assert.match(
    schedulerHooks,
    /export function useCompleteSchedulerJob\(\)[\s\S]*?invalidateQueries\(\{ queryKey: schedulerKeys\.all \}\)/,
  );
});

test('automatic final-invoice email uses the newly issued invoice revision', () => {
  assert.match(invoiceWorkspace, /Email the final invoice automatically after issue/);
  assert.match(
    invoiceWorkspace,
    /const issued = await onIssue\(expectedUpdatedAt\);[\s\S]*?queueInvoiceEmail\(issued\.updatedAt, emailContent\)/,
  );
});
