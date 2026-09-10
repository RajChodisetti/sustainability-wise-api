import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('./0061_installhub_photo_metadata.sql', import.meta.url),
  'utf8',
);

test('adds durable per-photo PDF metadata to every InstallHub photo-owning entity', () => {
  for (const table of [
    'ih_zones',
    'ih_electrical_assets',
    'ih_site_assets',
    'ih_meter_devices',
  ]) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE "${table}" ADD COLUMN "photo_metadata" jsonb DEFAULT '\\{\\}'::jsonb NOT NULL`),
    );
  }
});
