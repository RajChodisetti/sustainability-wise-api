ALTER TABLE "ih_installations" ADD COLUMN "existing_device_id" text;--> statement-breakpoint
ALTER TABLE "field_app_job_details" ADD COLUMN "existing_device_id" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_existing_device_id_length_check" CHECK (
    "ih_installations"."existing_device_id" IS NULL
    OR char_length(btrim("ih_installations"."existing_device_id")) BETWEEN 1 AND 10000
  );--> statement-breakpoint
ALTER TABLE "field_app_job_details" ADD CONSTRAINT "field_app_job_details_existing_device_id_check" CHECK ("field_app_job_details"."existing_device_id" IS NULL OR char_length(btrim("field_app_job_details"."existing_device_id")) BETWEEN 1 AND 10000);
