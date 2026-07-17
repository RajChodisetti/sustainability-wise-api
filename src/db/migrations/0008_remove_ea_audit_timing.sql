-- Audit duration tracking has been retired. Remove timing metadata from version
-- history as well as the live audit table so legacy sync payloads cannot leave
-- stale values behind.
UPDATE "record_versions"
SET "snapshot" = CASE
  WHEN jsonb_typeof("snapshot" -> 'audit') = 'object' THEN
    jsonb_set(
      "snapshot" - 'startedAt' - 'completedAt' - 'started_at' - 'completed_at',
      '{audit}',
      ("snapshot" -> 'audit') - 'startedAt' - 'completedAt' - 'started_at' - 'completed_at'
    )
  ELSE
    "snapshot" - 'startedAt' - 'completedAt' - 'started_at' - 'completed_at'
END
WHERE "app" = 'ecoaudit'
  AND "entity_type" = 'audit'
  AND jsonb_typeof("snapshot") = 'object'
  AND (
    "snapshot" ?| ARRAY['startedAt', 'completedAt', 'started_at', 'completed_at']
    OR (
      jsonb_typeof("snapshot" -> 'audit') = 'object'
      AND ("snapshot" -> 'audit') ?| ARRAY['startedAt', 'completedAt', 'started_at', 'completed_at']
    )
  );
--> statement-breakpoint
ALTER TABLE "ea_audits" DROP COLUMN IF EXISTS "started_at";
--> statement-breakpoint
ALTER TABLE "ea_audits" DROP COLUMN IF EXISTS "completed_at";
