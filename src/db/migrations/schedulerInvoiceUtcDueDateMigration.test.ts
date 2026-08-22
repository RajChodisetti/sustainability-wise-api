import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0044_integrated_scheduler_entity_features.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0043_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0044_snapshot.json', import.meta.url);

test('0044 installs the final invoice fence with UTC calendar-day due-date comparison', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const finalFunction = migration.slice(
    migration.lastIndexOf('CREATE OR REPLACE FUNCTION "scheduler_invoice_lifecycle_fence"()'),
  );
  assert.match(finalFunction, /Scheduler timestamps are persisted as UTC-naive values/);
  assert.match(finalFunction, /OR NEW\."due_date"::date < NEW\."issue_date"::date/);
  assert.doesNotMatch(finalFunction, /OR NEW\."due_date" < NEW\."issue_date"/);
});

test('the consolidated invoice fix shares the append-only 0044 schema snapshot', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  assert.deepEqual(journal.entries.find(({ idx }) => idx === 44), {
    idx: 44,
    version: '7',
    when: journal.entries.find(({ idx }) => idx === 44)?.when,
    tag: '0044_integrated_scheduler_entity_features',
    breakpoints: true,
  });

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as {
    id: string;
    prevId: string;
    [key: string]: unknown;
  };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    id: string;
    prevId: string;
    [key: string]: unknown;
  };
  const { id: previousId, prevId: _previousParent, ...previousSchema } = previousSnapshot;
  const { id: _snapshotId, prevId, ...snapshotSchema } = snapshot;

  assert.equal(prevId, previousId);
  assert.notDeepEqual(snapshotSchema, previousSchema);
});
