ALTER TABLE "scheduler_notification_jobs" DROP CONSTRAINT "scheduler_notification_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "scheduler_notification_jobs" ADD CONSTRAINT "scheduler_notification_jobs_kind_check" CHECK (
    "scheduler_notification_jobs"."notification_kind" IN (
      'assigned',
      'changed',
      'assignment_removed',
      'cancelled',
      'manual_reminder',
      'one_day_before',
      'one_hour_before',
      'day_of'
    )
  );--> statement-breakpoint
-- Backfill only reminders whose one-hour trigger is still strictly in the
-- future. Deployment must stop every pre-0041 notification worker before this
-- migration runs; old workers do not understand the new kind's time fence.
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
	'one_hour_before',
	'Job starts soon',
	'A scheduled job starts within an hour.',
	jsonb_build_object(
		'type', 'scheduler',
		'notificationKind', 'one_hour_before',
		'eventId', event.id,
		'sourceApp', event.source_app,
		'sourceType', event.source_type,
		'sourceId', event.source_id,
		'scheduledStartAt', to_char(
			(event.scheduled_start_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
			'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
		)
	),
	'scheduler:' || event.id || ':migration:one_hour_before:'
		|| extract(epoch FROM event.scheduled_start_at)::text,
	'queued',
	event.scheduled_start_at - interval '1 hour',
	0,
	16,
	now(),
	now()
FROM "portal_schedule_events" event
JOIN "global_users" canonical_user
	ON canonical_user.field_user_id = event.assignee_field_user_id
	AND canonical_user.is_active = true
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
					AND membership.is_active = true
					AND membership.deleted_at IS NULL
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
					AND membership.is_active = true
					AND membership.deleted_at IS NULL
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
				JOIN "unified_users" membership
					ON membership.global_user_id = canonical_user.id
					AND membership.origin_app = 'installhub'
					AND membership.is_active = true
					AND membership.deleted_at IS NULL
				WHERE installation.id = event.source_id
					AND installation.status = 'Draft'
					AND installation.deleted_at IS NULL
					AND installation.assigned_inspector_user_id = canonical_user.field_user_id
			)
		)
	)
	AND event.scheduled_start_at - interval '1 hour' > now()
	AND NOT EXISTS (
		SELECT 1
		FROM "scheduler_notification_jobs" existing
		WHERE existing.event_id = event.id
			AND existing.global_user_id = canonical_user.id
			AND existing.notification_kind = 'one_hour_before'
			AND existing.payload ->> 'scheduledStartAt' = to_char(
				(event.scheduled_start_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
				'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
			)
	)
ON CONFLICT ("dedupe_key") DO NOTHING;
