import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0057_installhub_meter_lifecycle_state.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0056_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0057_snapshot.json', import.meta.url);

test('0057 adds backward-compatible InstallHub meter lifecycle state', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(
    migration,
    /ALTER TABLE "ih_meter_devices" ADD COLUMN "lifecycle_state" text DEFAULT 'ACTIVE' NOT NULL/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "ih_meter_devices_lifecycle_state_check" CHECK \("ih_meter_devices"\."lifecycle_state" IN \('PLANNED', 'ACTIVE', 'INACTIVE'\)\)/,
  );
  assert.doesNotMatch(migration, /DROP\s|DELETE\s|TRUNCATE\s|UPDATE\s/i);

  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.deepEqual(
    journal.entries
      .filter(({ idx }) => idx === 56 || idx === 57)
      .map(({ idx, tag }) => ({ idx, tag })),
    [
      { idx: 56, tag: '0056_motionless_microchip' },
      { idx: 57, tag: '0057_installhub_meter_lifecycle_state' },
    ],
  );

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as {
    id: string;
  };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, {
      columns: Record<string, { notNull?: boolean; default?: string }>;
      checkConstraints: Record<string, { value: string }>;
    }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);
  const meterDevices = snapshot.tables['public.ih_meter_devices'];
  assert.deepEqual(meterDevices?.columns.lifecycle_state, {
    name: 'lifecycle_state',
    type: 'text',
    primaryKey: false,
    notNull: true,
    default: "'ACTIVE'",
  });
  assert.equal(
    meterDevices?.checkConstraints.ih_meter_devices_lifecycle_state_check?.value,
    '"ih_meter_devices"."lifecycle_state" IN (\'PLANNED\', \'ACTIVE\', \'INACTIVE\')',
  );
});
