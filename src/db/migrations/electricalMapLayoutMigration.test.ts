import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('electrical map layout migration adds revisioned installation presentation fields', async () => {
  const sql = await readFile(
    new URL('./0023_confused_blade.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /ADD COLUMN "electrical_map_layout" jsonb/);
  assert.match(sql, /ADD COLUMN "electrical_map_layout_revision" integer DEFAULT 0 NOT NULL/);
  assert.match(sql, /ADD COLUMN "electrical_map_layout_updated_at" timestamp/);
  assert.match(sql, /electrical_map_layout_revision_check/);
});
