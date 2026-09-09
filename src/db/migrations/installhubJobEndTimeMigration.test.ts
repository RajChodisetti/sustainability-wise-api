import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('./0060_installhub_job_end_time.sql', import.meta.url),
  'utf8',
);

test('adds an optional job end time to InstallHub installations', () => {
  assert.match(
    sql,
    /ALTER TABLE "ih_installations" ADD COLUMN "job_end_time" text/,
  );
  assert.doesNotMatch(sql, /NOT NULL/);
});
