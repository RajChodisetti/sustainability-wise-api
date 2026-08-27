ALTER TABLE "ih_installations" ADD COLUMN "custom_job_number" text;--> statement-breakpoint
ALTER TABLE "field_app_job_details" ADD COLUMN "custom_job_number" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_custom_job_number_length_check" CHECK (
    "ih_installations"."custom_job_number" IS NULL
    OR char_length(btrim("ih_installations"."custom_job_number")) BETWEEN 1 AND 100
  );--> statement-breakpoint
ALTER TABLE "field_app_job_details" ADD CONSTRAINT "field_app_job_details_custom_job_number_check" CHECK ("field_app_job_details"."custom_job_number" IS NULL OR char_length(btrim("field_app_job_details"."custom_job_number")) BETWEEN 1 AND 100);