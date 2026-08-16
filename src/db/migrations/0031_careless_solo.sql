CREATE TABLE "app_push_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"global_user_id" text NOT NULL,
	"app" text NOT NULL,
	"device_id" text NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text NOT NULL,
	"project_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"last_registered_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_push_devices_app_check" CHECK (
    "app_push_devices"."app" IN ('ecoaudit', 'solarsense', 'installhub')
  ),
	CONSTRAINT "app_push_devices_platform_check" CHECK (
    "app_push_devices"."platform" IN ('ios', 'android')
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"device_registration_id" text NOT NULL,
	"expo_push_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ticket_id" text,
	"receipt_available_at" timestamp,
	"receipt_checks" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_notification_deliveries_status_check" CHECK (
    "scheduler_notification_deliveries"."status" IN ('pending', 'ticketed', 'delivered', 'failed')
  ),
	CONSTRAINT "scheduler_notification_deliveries_receipt_checks_check" CHECK (
    "scheduler_notification_deliveries"."receipt_checks" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_notification_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"global_user_id" text NOT NULL,
	"source_app" text NOT NULL,
	"notification_kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"claim_token" text,
	"claimed_at" timestamp,
	"last_error" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_notification_jobs_source_app_check" CHECK (
    "scheduler_notification_jobs"."source_app" IN ('ecoaudit', 'solarsense', 'installhub')
  ),
	CONSTRAINT "scheduler_notification_jobs_kind_check" CHECK (
    "scheduler_notification_jobs"."notification_kind" IN (
      'assigned',
      'changed',
      'assignment_removed',
      'cancelled',
      'manual_reminder',
      'one_day_before',
      'day_of'
    )
  ),
	CONSTRAINT "scheduler_notification_jobs_status_check" CHECK (
    "scheduler_notification_jobs"."status" IN (
      'queued',
      'processing',
      'awaiting_receipts',
      'delivered',
      'failed',
      'cancelled'
    )
  ),
	CONSTRAINT "scheduler_notification_jobs_attempts_check" CHECK (
    "scheduler_notification_jobs"."attempts" >= 0 AND "scheduler_notification_jobs"."max_attempts" > 0
  )
);
--> statement-breakpoint
ALTER TABLE "app_push_devices" ADD CONSTRAINT "app_push_devices_global_user_id_global_users_id_fk" FOREIGN KEY ("global_user_id") REFERENCES "public"."global_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_notification_deliveries" ADD CONSTRAINT "scheduler_notification_deliveries_job_id_scheduler_notification_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scheduler_notification_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_notification_deliveries" ADD CONSTRAINT "scheduler_notification_deliveries_device_registration_id_app_push_devices_id_fk" FOREIGN KEY ("device_registration_id") REFERENCES "public"."app_push_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_notification_jobs" ADD CONSTRAINT "scheduler_notification_jobs_event_id_portal_schedule_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."portal_schedule_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_notification_jobs" ADD CONSTRAINT "scheduler_notification_jobs_global_user_id_global_users_id_fk" FOREIGN KEY ("global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_push_devices_app_device_unique" ON "app_push_devices" USING btree ("app","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_push_devices_active_token_unique" ON "app_push_devices" USING btree ("app","expo_push_token") WHERE "app_push_devices"."enabled" = true;--> statement-breakpoint
CREATE INDEX "app_push_devices_user_app_enabled_idx" ON "app_push_devices" USING btree ("global_user_id","app","enabled");--> statement-breakpoint
CREATE INDEX "app_push_devices_token_idx" ON "app_push_devices" USING btree ("app","expo_push_token");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_notification_deliveries_job_device_unique" ON "scheduler_notification_deliveries" USING btree ("job_id","device_registration_id");--> statement-breakpoint
CREATE INDEX "scheduler_notification_deliveries_receipt_idx" ON "scheduler_notification_deliveries" USING btree ("status","receipt_available_at");--> statement-breakpoint
CREATE INDEX "scheduler_notification_deliveries_job_idx" ON "scheduler_notification_deliveries" USING btree ("job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_notification_jobs_dedupe_unique" ON "scheduler_notification_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "scheduler_notification_jobs_claim_idx" ON "scheduler_notification_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "scheduler_notification_jobs_event_idx" ON "scheduler_notification_jobs" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "scheduler_notification_jobs_target_idx" ON "scheduler_notification_jobs" USING btree ("global_user_id","source_app","status");
--> statement-breakpoint
INSERT INTO "scheduler_notification_jobs" (
	"id", "event_id", "global_user_id", "source_app", "notification_kind",
	"title", "body", "payload", "dedupe_key", "status", "available_at",
	"attempts", "max_attempts", "created_at", "updated_at"
)
SELECT
	gen_random_uuid()::text,
	event.id,
	canonical_user.id,
	event.source_app,
	'one_day_before',
	'Upcoming job',
	'A scheduled job is coming up.',
	jsonb_build_object(
		'type', 'scheduler',
		'notificationKind', 'one_day_before',
		'eventId', event.id,
		'sourceApp', event.source_app,
		'sourceType', event.source_type,
		'sourceId', event.source_id,
		'scheduledStartAt', to_char(
			event.scheduled_start_at,
			'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
		)
	),
	'scheduler:' || event.id || ':migration:one_day_before:'
		|| extract(epoch FROM event.scheduled_start_at)::text,
	'queued',
	event.scheduled_start_at - interval '24 hours',
	0,
	16,
	now(),
	now()
FROM "portal_schedule_events" event
JOIN "global_users" canonical_user
	ON canonical_user.field_user_id = event.assignee_field_user_id
WHERE event.status IN ('planned', 'in_progress')
	AND event.source_id IS NOT NULL
	AND (
		(
			event.source_app = 'ecoaudit'
			AND event.source_type = 'audit'
			AND EXISTS (
				SELECT 1
				FROM "ea_audits" audit
				JOIN "unified_users" membership
					ON membership.global_user_id = canonical_user.id
					AND membership.origin_app = 'ecoaudit'
					AND membership.origin_user_id = audit.assigned_inspector_user_id
				WHERE audit.id = event.source_id
					AND audit.status = 'Draft'
					AND audit.deleted_at IS NULL
			)
		)
		OR (
			event.source_app = 'solarsense'
			AND event.source_type = 'assessment'
			AND EXISTS (
				SELECT 1
				FROM "ss_rooftop_assessments" assessment
				JOIN "ss_sites" site
					ON site.id = assessment.site_id
					AND site.status = 'Draft'
					AND site.deleted_at IS NULL
				JOIN "unified_users" membership
					ON membership.global_user_id = canonical_user.id
					AND membership.origin_app = 'solarsense'
					AND membership.origin_user_id = assessment.assigned_inspector_user_id
				WHERE assessment.id = event.source_id
					AND assessment.status = 'Draft'
					AND assessment.deleted_at IS NULL
			)
		)
		OR (
			event.source_app = 'installhub'
			AND event.source_type = 'installation'
			AND EXISTS (
				SELECT 1
				FROM "ih_installations" installation
				WHERE installation.id = event.source_id
					AND installation.status = 'Draft'
					AND installation.deleted_at IS NULL
					AND installation.assigned_inspector_user_id = event.assignee_field_user_id
			)
		)
	)
	AND event.scheduled_start_at - interval '24 hours' > now()
ON CONFLICT ("dedupe_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "scheduler_notification_jobs" (
	"id", "event_id", "global_user_id", "source_app", "notification_kind",
	"title", "body", "payload", "dedupe_key", "status", "available_at",
	"attempts", "max_attempts", "created_at", "updated_at"
)
SELECT
	gen_random_uuid()::text,
	event.id,
	canonical_user.id,
	event.source_app,
	'day_of',
	'Scheduled job reminder',
	'You have a scheduled job.',
	jsonb_build_object(
		'type', 'scheduler',
		'notificationKind', 'day_of',
		'eventId', event.id,
		'sourceApp', event.source_app,
		'sourceType', event.source_type,
		'sourceId', event.source_id,
		'scheduledStartAt', to_char(
			event.scheduled_start_at,
			'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
		)
	),
	'scheduler:' || event.id || ':migration:day_of:'
		|| extract(epoch FROM event.scheduled_start_at)::text,
	'queued',
	event.scheduled_start_at,
	0,
	16,
	now(),
	now()
FROM "portal_schedule_events" event
JOIN "global_users" canonical_user
	ON canonical_user.field_user_id = event.assignee_field_user_id
WHERE event.status IN ('planned', 'in_progress')
	AND event.source_id IS NOT NULL
	AND (
		(
			event.source_app = 'ecoaudit'
			AND event.source_type = 'audit'
			AND EXISTS (
				SELECT 1
				FROM "ea_audits" audit
				JOIN "unified_users" membership
					ON membership.global_user_id = canonical_user.id
					AND membership.origin_app = 'ecoaudit'
					AND membership.origin_user_id = audit.assigned_inspector_user_id
				WHERE audit.id = event.source_id
					AND audit.status = 'Draft'
					AND audit.deleted_at IS NULL
			)
		)
		OR (
			event.source_app = 'solarsense'
			AND event.source_type = 'assessment'
			AND EXISTS (
				SELECT 1
				FROM "ss_rooftop_assessments" assessment
				JOIN "ss_sites" site
					ON site.id = assessment.site_id
					AND site.status = 'Draft'
					AND site.deleted_at IS NULL
				JOIN "unified_users" membership
					ON membership.global_user_id = canonical_user.id
					AND membership.origin_app = 'solarsense'
					AND membership.origin_user_id = assessment.assigned_inspector_user_id
				WHERE assessment.id = event.source_id
					AND assessment.status = 'Draft'
					AND assessment.deleted_at IS NULL
			)
		)
		OR (
			event.source_app = 'installhub'
			AND event.source_type = 'installation'
			AND EXISTS (
				SELECT 1
				FROM "ih_installations" installation
				WHERE installation.id = event.source_id
					AND installation.status = 'Draft'
					AND installation.deleted_at IS NULL
					AND installation.assigned_inspector_user_id = event.assignee_field_user_id
			)
		)
	)
	AND event.scheduled_start_at > now()
ON CONFLICT ("dedupe_key") DO NOTHING;
