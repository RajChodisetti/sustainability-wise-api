import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('0048 adds custom job numbers without removing legacy Fergus or quote data', () => {
  const sql = readFileSync(new URL('./0048_jittery_wallow.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE "ih_installations" ADD COLUMN "custom_job_number" text/);
  assert.match(sql, /ALTER TABLE "field_app_job_details" ADD COLUMN "custom_job_number" text/);
  assert.match(sql, /custom_job_number_length_check/);
  assert.doesNotMatch(sql, /DROP (?:COLUMN|TABLE)/i);
  assert.doesNotMatch(sql, /RENAME COLUMN "(?:fergus_job_number|quote_number)"/i);
});
