import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('./0062_ecoaudit_water_assets.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('./meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

test('creates the canonical EcoAudit water asset table and subtype constraint', () => {
  assert.match(sql, /CREATE TABLE "ea_water_assets"/);
  for (const column of [
    'asset_type',
    'name',
    'category',
    'data',
    'general_comments',
    'custom_fields',
    'photos',
    'photo_descs',
  ]) {
    assert.match(sql, new RegExp(`"${column}"`));
  }
  for (const assetType of [
    'water_meter',
    'water_submeter_logger',
    'water_fixture',
    'water_asset_system',
  ]) {
    assert.match(sql, new RegExp(`'${assetType}'`));
  }
  assert.match(sql, /jsonb_typeof\("custom_fields"\) = 'array'/);
  assert.match(sql, /CREATE INDEX "ea_water_assets_audit_idx"/);
  assert.match(sql, /CREATE INDEX "ea_water_assets_zone_idx"/);
  const entry = journal.entries.find(({ idx }) => idx === 62);
  assert.deepEqual(entry, {
    idx: 62,
    version: '7',
    when: 1790102209000,
    tag: '0062_ecoaudit_water_assets',
    breakpoints: true,
  });
  assert.ok(journal.entries.some(({ idx }) => idx > 62), 'later migrations remain append-only');
});
