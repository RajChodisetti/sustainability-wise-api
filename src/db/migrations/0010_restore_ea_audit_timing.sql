-- Production previously applied 0008_remove_ea_audit_timing from another
-- release line. The current EcoAudit API still reads and writes these fields,
-- so restore them with a forward-only, idempotent migration.
ALTER TABLE "ea_audits" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
--> statement-breakpoint
UPDATE "ea_audits"
SET "started_at" = COALESCE("started_at", "created_at"),
    "completed_at" = COALESCE("completed_at", "updated_at")
WHERE "status" = 'Completed';
