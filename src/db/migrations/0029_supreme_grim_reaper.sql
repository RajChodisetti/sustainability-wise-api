ALTER TABLE "ss_rooftop_assessments" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
UPDATE "ss_rooftop_assessments"
SET "completed_at" = "updated_at"
WHERE "status" = 'Completed' AND "completed_at" IS NULL;--> statement-breakpoint
UPDATE "ss_sites"
SET "completed_at" = "updated_at"
WHERE "status" = 'Completed' AND "completed_at" IS NULL;
