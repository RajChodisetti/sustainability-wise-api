CREATE TABLE "app_push_device_fences" (
	"app" text NOT NULL,
	"device_id" text NOT NULL,
	"global_user_id" text NOT NULL,
	"registration_generation" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_push_device_fences_pk" PRIMARY KEY("app","device_id","global_user_id"),
	CONSTRAINT "app_push_device_fences_app_check" CHECK (
    "app_push_device_fences"."app" IN ('ecoaudit', 'solarsense', 'installhub')
  ),
	CONSTRAINT "app_push_device_fences_generation_check" CHECK (
    "app_push_device_fences"."registration_generation" > 0
      AND "app_push_device_fences"."registration_generation" <= 9007199254740991
  )
);
--> statement-breakpoint
ALTER TABLE "app_push_devices" ADD COLUMN "registration_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduler_notification_deliveries" ADD COLUMN "registration_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "scheduler_notification_jobs"
SET "max_attempts" = 16
WHERE "max_attempts" < 16;--> statement-breakpoint
ALTER TABLE "scheduler_notification_jobs" ALTER COLUMN "max_attempts" SET DEFAULT 16;--> statement-breakpoint
INSERT INTO "app_push_device_fences" (
	"app", "device_id", "global_user_id", "registration_generation",
	"enabled", "created_at", "updated_at"
)
SELECT
	device.app,
	device.device_id,
	device.global_user_id,
	device.registration_generation,
	CASE
		WHEN device.disabled_reason = 'DeviceNotRegistered' THEN true
		ELSE device.enabled
	END,
	device.created_at,
	device.updated_at
FROM "app_push_devices" device
ON CONFLICT ("app", "device_id", "global_user_id") DO UPDATE SET
	"registration_generation" = EXCLUDED."registration_generation",
	"enabled" = EXCLUDED."enabled",
	"updated_at" = EXCLUDED."updated_at";--> statement-breakpoint
ALTER TABLE "app_push_devices" ALTER COLUMN "registration_generation" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "scheduler_notification_deliveries" ALTER COLUMN "registration_generation" DROP DEFAULT;--> statement-breakpoint
UPDATE "scheduler_notification_deliveries" delivery
SET
	"status" = 'failed',
	"last_error" = 'notification_job_no_longer_active',
	"completed_at" = now(),
	"updated_at" = now()
WHERE delivery.status IN ('pending', 'ticketed')
	AND EXISTS (
		SELECT 1
		FROM "scheduler_notification_jobs" job
		WHERE job.id = delivery.job_id
			AND job.status IN ('cancelled', 'failed', 'delivered')
	);--> statement-breakpoint
ALTER TABLE "app_push_device_fences" ADD CONSTRAINT "app_push_device_fences_global_user_id_global_users_id_fk" FOREIGN KEY ("global_user_id") REFERENCES "public"."global_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_push_device_fences_owner_idx" ON "app_push_device_fences" USING btree ("global_user_id","app","enabled");--> statement-breakpoint
ALTER TABLE "app_push_devices" ADD CONSTRAINT "app_push_devices_generation_check" CHECK (
    "app_push_devices"."registration_generation" > 0
      AND "app_push_devices"."registration_generation" <= 9007199254740991
  );--> statement-breakpoint
ALTER TABLE "scheduler_notification_deliveries" ADD CONSTRAINT "scheduler_notification_deliveries_generation_check" CHECK (
    "scheduler_notification_deliveries"."registration_generation" > 0
      AND "scheduler_notification_deliveries"."registration_generation" <= 9007199254740991
  );
