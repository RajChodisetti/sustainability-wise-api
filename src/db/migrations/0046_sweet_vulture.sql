ALTER TABLE "business_jobs" ADD COLUMN "revision_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "business_jobs" ADD COLUMN "previous_job_id" text;--> statement-breakpoint
ALTER TABLE "business_jobs" ADD CONSTRAINT "business_jobs_previous_job_fk" FOREIGN KEY ("previous_job_id") REFERENCES "public"."business_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "site_id", "source_app"
			ORDER BY "created_at", "id"
		)::integer AS "revision_number",
		lag("id") OVER (
			PARTITION BY "site_id", "source_app"
			ORDER BY "created_at", "id"
		) AS "previous_job_id"
	FROM "business_jobs"
)
UPDATE "business_jobs" AS target
SET
	"revision_number" = ranked."revision_number",
	"previous_job_id" = ranked."previous_job_id"
FROM ranked
WHERE target."id" = ranked."id";--> statement-breakpoint
CREATE UNIQUE INDEX "business_jobs_site_app_revision_unique" ON "business_jobs" USING btree ("site_id","source_app","revision_number");--> statement-breakpoint
ALTER TABLE "business_jobs" ADD CONSTRAINT "business_jobs_revision_check" CHECK ("business_jobs"."revision_number" >= 1);
