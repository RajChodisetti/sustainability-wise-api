CREATE TABLE IF NOT EXISTS "portal_schedule_events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source_app" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"assignee_field_user_id" text NOT NULL,
	"assignee_display_name" text,
	"assignee_email" text,
	"scheduled_start_at" timestamp NOT NULL,
	"scheduled_end_at" timestamp,
	"deadline_at" timestamp NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_app" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_at" timestamp,
	CONSTRAINT "portal_schedule_events_source_app_check" CHECK ("source_app" IN ('ecoaudit', 'solarsense', 'installhub', 'custom')),
	CONSTRAINT "portal_schedule_events_source_type_check" CHECK ("source_type" IN ('audit', 'site', 'assessment', 'installation', 'custom')),
	CONSTRAINT "portal_schedule_events_status_check" CHECK ("status" IN ('planned', 'in_progress', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_schedule_events_assignee_start_idx" ON "portal_schedule_events" USING btree ("assignee_field_user_id","scheduled_start_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_schedule_events_deadline_idx" ON "portal_schedule_events" USING btree ("deadline_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_schedule_events_source_idx" ON "portal_schedule_events" USING btree ("source_app","source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_schedule_events_start_idx" ON "portal_schedule_events" USING btree ("scheduled_start_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_schedule_events_status_idx" ON "portal_schedule_events" USING btree ("status");
