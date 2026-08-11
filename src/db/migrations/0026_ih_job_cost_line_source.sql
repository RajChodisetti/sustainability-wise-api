ALTER TABLE "ih_job_cost_lines" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ih_job_cost_lines" ADD CONSTRAINT "ih_job_cost_lines_source_check" CHECK ("source" IN ('manual', 'auto_labour'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
