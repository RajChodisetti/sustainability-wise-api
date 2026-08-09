CREATE TABLE "ih_meter_history_events" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"operation" text NOT NULL,
	"source_form_submission_id" text,
	"from_record_version_number" integer NOT NULL,
	"to_record_version_number" integer NOT NULL,
	"restored_from_record_version_number" integer,
	"reason" text,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_meter_history_events_operation_check" CHECK ("ih_meter_history_events"."operation" IN ('REPLACEMENT', 'ROLLBACK')),
	CONSTRAINT "ih_meter_history_events_versions_check" CHECK ("ih_meter_history_events"."from_record_version_number" > 0 AND "ih_meter_history_events"."to_record_version_number" > 0),
	CONSTRAINT "ih_meter_history_events_restored_version_check" CHECK ("ih_meter_history_events"."restored_from_record_version_number" IS NULL OR "ih_meter_history_events"."restored_from_record_version_number" > 0),
	CONSTRAINT "ih_meter_history_events_shape_check" CHECK ((
      "ih_meter_history_events"."operation" = 'REPLACEMENT'
      AND "ih_meter_history_events"."source_form_submission_id" IS NOT NULL
      AND "ih_meter_history_events"."restored_from_record_version_number" IS NULL
      AND "ih_meter_history_events"."reason" IS NULL
    ) OR (
      "ih_meter_history_events"."operation" = 'ROLLBACK'
      AND "ih_meter_history_events"."source_form_submission_id" IS NULL
      AND "ih_meter_history_events"."restored_from_record_version_number" IS NOT NULL
      AND length(btrim("ih_meter_history_events"."reason")) >= 3
    ))
);
--> statement-breakpoint
ALTER TABLE "ih_meter_history_events" ADD CONSTRAINT "ih_meter_history_events_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."ih_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ih_meter_history_events_meter_idx" ON "ih_meter_history_events" USING btree ("installation_id","meter_id","created_at");--> statement-breakpoint
CREATE INDEX "ih_meter_history_events_version_idx" ON "ih_meter_history_events" USING btree ("installation_id","to_record_version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ih_meter_history_events_source_form_unique" ON "ih_meter_history_events" USING btree ("installation_id","source_form_submission_id") WHERE "ih_meter_history_events"."source_form_submission_id" IS NOT NULL;