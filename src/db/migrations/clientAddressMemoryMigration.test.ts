import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('./0049_dry_red_wolf.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('./meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const previousSnapshot = JSON.parse(readFileSync(
  new URL('./meta/0048_snapshot.json', import.meta.url),
  'utf8',
)) as { id: string };
const snapshot = JSON.parse(readFileSync(
  new URL('./meta/0049_snapshot.json', import.meta.url),
  'utf8',
)) as {
  prevId: string;
  tables: Record<string, { columns: Record<string, unknown> }>;
};
const clientMemoryService = readFileSync(
  new URL('../../services/clientSiteMemoryService.ts', import.meta.url),
  'utf8',
);

test('0049 expands and backfills client/address memory before enforcing constraints', () => {
  assert.match(migration, /CREATE TABLE "business_client_merge_events"/);
  assert.match(migration, /ADD COLUMN "company_key" text;/);
  assert.match(migration, /ADD COLUMN "normalized_key" text;/);
  assert.match(migration, /regexp_replace\(btrim\("name"\)/);
  assert.ok(
    migration.indexOf('business_clients_memory_defaults_trigger')
      < migration.indexOf('ALTER COLUMN "normalized_key" SET NOT NULL'),
  );
  assert.ok(
    migration.indexOf('business_sites_memory_defaults_trigger')
      < migration.indexOf('ALTER COLUMN "address_fingerprint" SET NOT NULL'),
  );
  assert.match(migration, /legacy_address_change[\s\S]+NEW\.latitude := NULL/);
  assert.ok(
    migration.indexOf('UPDATE "business_clients"')
      < migration.indexOf('ALTER COLUMN "normalized_key" SET NOT NULL'),
  );
  assert.ok(
    migration.indexOf('UPDATE "business_sites"\nSET')
      < migration.indexOf('ALTER COLUMN "address_fingerprint" SET NOT NULL'),
  );
  assert.match(migration, /chr\(31\)/);
  assert.match(migration, /chr\(30\) \|\| '2'/);
  assert.match(migration, /UPDATE "ea_audits" ea\s+SET "business_site_id"/);
  assert.match(migration, /UPDATE "ih_installations" ih\s+SET "business_site_id"/);
  assert.match(migration, /WITH solar_links AS/);
  assert.match(
    migration,
    /provider IS NOT NULL AND place_id IS NOT NULL THEN 2[\s\S]+END DESC,[\s\S]+"updated_at" DESC/,
  );
  assert.match(migration, /IN \('geoapify', 'photon'\)/);
  assert.equal(
    (migration.match(/"site_geocode_status" = CASE/g) ?? []).length,
    3,
  );
  assert.match(migration, /do not merge normalized duplicates here/i);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN/i);
});

test('0049 and runtime share one explicit, non-configurable company scope', () => {
  assert.match(migration, /NEW\.company_key := 'sustainability-wise'/);
  assert.match(
    clientMemoryService,
    /BUSINESS_COMPANY_KEY = 'sustainability-wise' as const/,
  );
  assert.doesNotMatch(clientMemoryService, /config\.businessDirectory/);
});

test('0049 snapshot and append-only journal follow 0048', () => {
  assert.equal(journal.entries.find(({ idx }) => idx === 49)?.tag, '0049_dry_red_wolf');
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(snapshot.tables['public.business_client_merge_events']);
  assert.ok(snapshot.tables['public.business_clients']?.columns.company_key);
  assert.ok(snapshot.tables['public.business_clients']?.columns.normalized_key);
  assert.ok(snapshot.tables['public.business_sites']?.columns.address_fingerprint);
  assert.ok(snapshot.tables['public.ea_audits']?.columns.business_site_id);
  assert.ok(snapshot.tables['public.ss_sites']?.columns.business_site_id);
  assert.ok(snapshot.tables['public.ih_installations']?.columns.business_site_id);
});
