import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0044_integrated_scheduler_entity_features.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);

test('0044 adds only nullable structured location columns and Australian checks', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  for (const table of ['ea_audits', 'ss_sites', 'ih_installations']) {
    for (const column of [
      'site_locality',
      'site_state',
      'site_postcode',
      'site_country_code',
      'site_latitude',
      'site_longitude',
      'site_geocode_status',
      'site_geocode_provider',
      'site_geocode_place_id',
      'site_address_fingerprint',
      'site_geocoded_at',
    ]) {
      assert.match(migration, new RegExp(
        `ALTER TABLE "${table}" ADD COLUMN "${column}"`,
      ));
    }
  }
  assert.equal(migration.match(/ADD CONSTRAINT "[^"]+_country_check"/g)?.length, 3);
  assert.equal(migration.match(/ADD CONSTRAINT "[^"]+_postcode_check"/g)?.length, 3);
  assert.equal(migration.match(/ADD CONSTRAINT "[^"]+_coordinates_check"/g)?.length, 3);
  assert.equal(migration.match(/ADD CONSTRAINT "[^"]+_geocode_status_check"/g)?.length, 3);
  assert.equal(migration.match(/ADD CONSTRAINT "[^"]+_address_fingerprint_check"/g)?.length, 3);
  assert.doesNotMatch(migration, /ADD COLUMN "site_[^"]+"[^;]*NOT NULL/);
  assert.equal(migration.match(/site_latitude" BETWEEN -44 AND -9/g)?.length, 3);
  assert.equal(migration.match(/site_longitude" BETWEEN 112 AND 154/g)?.length, 3);
  assert.doesNotMatch(migration, /UPDATE\s+"(?:ea_audits|ss_sites|ih_installations)"\s+SET/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"(?:ea_audits|ss_sites|ih_installations)"/i);
  assert.doesNotMatch(migration, /DROP COLUMN/);
});

test('structured routing storage is part of the consolidated 0044 journal entry', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const entry = journal.entries.find(({ idx }) => idx === 44);
  assert.deepEqual(entry, {
    ...entry,
    idx: 44,
    tag: '0044_integrated_scheduler_entity_features',
  });
});
