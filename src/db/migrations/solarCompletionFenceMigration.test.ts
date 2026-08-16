import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0029_supreme_grim_reaper.sql', import.meta.url);

test('SolarSense completion fence migration adds and backfills immutable boundaries', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  for (const table of ['ss_sites', 'ss_rooftop_assessments']) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE "${table}" ADD COLUMN "completed_at" timestamp`),
    );
    assert.match(
      sql,
      new RegExp(
        `UPDATE "${table}"[\\s\\S]*SET "completed_at" = "updated_at"[\\s\\S]*WHERE "status" = 'Completed' AND "completed_at" IS NULL`,
      ),
    );
  }

  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
});
