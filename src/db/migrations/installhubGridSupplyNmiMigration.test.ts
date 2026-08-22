import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0044_integrated_scheduler_entity_features.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0043_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0044_snapshot.json', import.meta.url);

test('0044 adds the canonical nullable trimmed 100-character grid-supply NMI fence', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(
    migration,
    /ALTER TABLE "ih_grid_supplies" ADD CONSTRAINT "ih_grid_supplies_nmi_length_check" CHECK/,
  );
  assert.match(
    migration,
    /"nmi" IS NULL OR char_length\(btrim\("ih_grid_supplies"\."nmi"\)\) BETWEEN 1 AND 100/,
  );
  assert.doesNotMatch(migration, /UPDATE\s+"ih_grid_supplies"\s+SET/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"ih_grid_supplies"/i);
  assert.doesNotMatch(migration, /DROP COLUMN|TRUNCATE/i);
});

test('0044 snapshot and append-only journal follow upstream 0043', async () => {
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
  };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, {
      checkConstraints?: Record<string, { name: string; value: string }>;
    }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);
  const constraint = snapshot.tables['public.ih_grid_supplies']
    ?.checkConstraints?.ih_grid_supplies_nmi_length_check;
  assert.equal(constraint?.name, 'ih_grid_supplies_nmi_length_check');
  assert.match(constraint?.value ?? '', /BETWEEN 1 AND 100/);
});
