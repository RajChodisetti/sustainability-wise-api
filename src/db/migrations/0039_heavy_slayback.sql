-- Historical rows are append-only audit evidence and can contain fractional
-- values written before whole billable hours became mandatory. NOT VALID keeps
-- those records intact while PostgreSQL still checks every new or updated row.
ALTER TABLE "scheduler_job_hour_overrides" ADD CONSTRAINT "scheduler_job_hour_overrides_billable_whole_hours_check" CHECK (
    "scheduler_job_hour_overrides"."billable_milliseconds" IS NULL
    OR mod("scheduler_job_hour_overrides"."billable_milliseconds", 3600000) = 0
  ) NOT VALID;
