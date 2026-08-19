ALTER TABLE "portal_schedule_events" ADD COLUMN "estimated_duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "portal_schedule_events" ADD CONSTRAINT "portal_schedule_events_estimated_duration_check" CHECK (
    "portal_schedule_events"."estimated_duration_minutes" IS NULL
    OR (
      "portal_schedule_events"."estimated_duration_minutes" > 0
      AND "portal_schedule_events"."estimated_duration_minutes" <= 10080
    )
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "portal_schedule_events" VALIDATE CONSTRAINT "portal_schedule_events_estimated_duration_check";
