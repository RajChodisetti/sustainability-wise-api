CREATE TABLE "scheduler_invoice_email_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"pdf_job_id" text NOT NULL,
	"source_updated_at" timestamp NOT NULL,
	"attachment_filename" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"requested_by_global_user_id" text NOT NULL,
	"requested_by_display_name" text,
	"requested_by_app" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"claim_token" text,
	"claimed_at" timestamp,
	"provider_submission_started_at" timestamp,
	"provider" text DEFAULT 'gmail_api' NOT NULL,
	"provider_message_id" text,
	"last_error_code" text,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_invoice_email_status_check" CHECK (
    "scheduler_invoice_email_deliveries"."status" IN ('queued', 'processing', 'sent', 'failed', 'delivery_unknown')
  ),
	CONSTRAINT "scheduler_invoice_email_attempts_check" CHECK (
    "scheduler_invoice_email_deliveries"."attempts" >= 0
    AND "scheduler_invoice_email_deliveries"."max_attempts" > 0
    AND "scheduler_invoice_email_deliveries"."attempts" <= "scheduler_invoice_email_deliveries"."max_attempts"
  ),
	CONSTRAINT "scheduler_invoice_email_provider_check" CHECK ("scheduler_invoice_email_deliveries"."provider" = 'gmail_api'),
	CONSTRAINT "scheduler_invoice_email_request_app_check" CHECK (
    "scheduler_invoice_email_deliveries"."requested_by_app" IN ('ecoaudit', 'solarsense', 'installhub')
  ),
	CONSTRAINT "scheduler_invoice_email_fingerprint_check" CHECK (
    "scheduler_invoice_email_deliveries"."request_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
	CONSTRAINT "scheduler_invoice_email_text_check" CHECK (
    length(btrim("scheduler_invoice_email_deliveries"."idempotency_key")) > 0
    AND length(btrim("scheduler_invoice_email_deliveries"."attachment_filename")) > 0
    AND length(btrim("scheduler_invoice_email_deliveries"."recipient")) > 0
    AND length(btrim("scheduler_invoice_email_deliveries"."subject")) > 0
  ),
	CONSTRAINT "scheduler_invoice_email_claim_check" CHECK (
    ("scheduler_invoice_email_deliveries"."status" = 'processing' AND "scheduler_invoice_email_deliveries"."claim_token" IS NOT NULL AND "scheduler_invoice_email_deliveries"."claimed_at" IS NOT NULL)
    OR ("scheduler_invoice_email_deliveries"."status" <> 'processing' AND "scheduler_invoice_email_deliveries"."claim_token" IS NULL AND "scheduler_invoice_email_deliveries"."claimed_at" IS NULL)
  ),
	CONSTRAINT "scheduler_invoice_email_completion_check" CHECK (
    ("scheduler_invoice_email_deliveries"."status" = 'sent'
      AND "scheduler_invoice_email_deliveries"."sent_at" IS NOT NULL
      AND "scheduler_invoice_email_deliveries"."completed_at" IS NOT NULL
      AND "scheduler_invoice_email_deliveries"."provider_message_id" IS NOT NULL)
    OR ("scheduler_invoice_email_deliveries"."status" IN ('failed', 'delivery_unknown')
      AND "scheduler_invoice_email_deliveries"."sent_at" IS NULL
      AND "scheduler_invoice_email_deliveries"."completed_at" IS NOT NULL)
    OR ("scheduler_invoice_email_deliveries"."status" IN ('queued', 'processing')
      AND "scheduler_invoice_email_deliveries"."sent_at" IS NULL
      AND "scheduler_invoice_email_deliveries"."completed_at" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_email_deliveries" ADD CONSTRAINT "scheduler_invoice_email_deliveries_invoice_id_scheduler_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."scheduler_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_invoice_email_deliveries" ADD CONSTRAINT "scheduler_invoice_email_deliveries_pdf_job_id_pdf_jobs_id_fk" FOREIGN KEY ("pdf_job_id") REFERENCES "public"."pdf_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_invoice_email_deliveries" ADD CONSTRAINT "scheduler_invoice_email_deliveries_requested_by_global_user_id_global_users_id_fk" FOREIGN KEY ("requested_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_invoice_email_idempotency_unique" ON "scheduler_invoice_email_deliveries" USING btree ("invoice_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "scheduler_invoice_email_invoice_created_idx" ON "scheduler_invoice_email_deliveries" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "scheduler_invoice_email_status_available_idx" ON "scheduler_invoice_email_deliveries" USING btree ("status","available_at");
--> statement-breakpoint
-- The provider-start transaction locks scheduler_invoices before publishing its
-- marker. A concurrent void therefore has only two legal orderings: it commits
-- first and the worker observes void, or it follows the marker and this fence
-- rejects it. Keeping the fence in PostgreSQL protects rolling old API writers.
CREATE OR REPLACE FUNCTION "scheduler_invoice_email_void_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."status" = 'void'
		AND OLD."status" IS DISTINCT FROM 'void'
		AND EXISTS (
			SELECT 1
			FROM "scheduler_invoice_email_deliveries"
			WHERE "invoice_id" = OLD."id"
				AND "status" = 'processing'
				AND "provider_submission_started_at" IS NOT NULL
		)
	THEN
		RAISE EXCEPTION 'scheduler_invoice_email_delivery_in_progress'
			USING ERRCODE = '23514',
				CONSTRAINT = 'scheduler_invoice_email_void_delivery_fence';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_invoice_email_void_fence_trigger"
BEFORE UPDATE OF "status" ON "scheduler_invoices"
FOR EACH ROW EXECUTE FUNCTION "scheduler_invoice_email_void_fence"();
