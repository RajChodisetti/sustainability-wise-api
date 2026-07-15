ALTER TABLE "ea_audits" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
--> statement-breakpoint
-- Backfill completed audits so admin duration is available immediately.
UPDATE "ea_audits"
SET "started_at" = COALESCE("started_at", "created_at"),
    "completed_at" = COALESCE("completed_at", "updated_at")
WHERE "status" = 'Completed';
