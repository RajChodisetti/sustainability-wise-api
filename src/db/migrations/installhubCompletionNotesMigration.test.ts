import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0043_installhub_completion_notes.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0042_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0043_snapshot.json', import.meta.url);

test('0043 adds bounded nullable InstallHub completion notes as an expand-only delta', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(
    migration,
    /ALTER TABLE "ih_installations" ADD COLUMN "completion_notes" text/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "ih_installations_completion_notes_length_check" CHECK \("ih_installations"\."completion_notes" IS NULL OR char_length\("ih_installations"\."completion_notes"\) <= 2000\) NOT VALID/,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "ih_installations_completion_notes_length_check"/,
  );
  assert.doesNotMatch(migration, /DROP\s|DELETE\s|TRUNCATE\s|UPDATE\s/i);

  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.deepEqual(
    journal.entries
      .filter(({ idx }) => idx === 42 || idx === 43)
      .map(({ idx, tag }) => ({ idx, tag })),
    [
    { idx: 42, tag: '0042_third_wilson_fisk' },
    { idx: 43, tag: '0043_installhub_completion_notes' },
    ],
  );

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as {
    id: string;
  };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, {
      columns: Record<string, unknown>;
      checkConstraints: Record<string, { value: string }>;
    }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);
  const installation = snapshot.tables['public.ih_installations'];
  assert.ok(installation?.columns.completion_notes);
  assert.match(
    installation.checkConstraints.ih_installations_completion_notes_length_check?.value ?? '',
    /char_length\("ih_installations"\."completion_notes"\) <= 2000/,
  );
});
