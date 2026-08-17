ALTER TABLE "pdf_jobs" ADD CONSTRAINT "pdf_jobs_scheduler_invoice_claim_terminal_check" CHECK (
    "pdf_jobs"."entity_type" <> 'scheduler_invoice'
    OR "pdf_jobs"."status" IN ('queued', 'running')
    OR (
      "pdf_jobs"."status" IN ('complete', 'failed')
      AND "pdf_jobs"."claim_token" IS NULL
      AND "pdf_jobs"."claim_expires_at" IS NULL
    )
  );--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_invoice_pdf_failed_write_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."entity_type" = 'scheduler_invoice'
		AND OLD."status" IN ('queued', 'running')
		AND NEW."status" = 'failed'
		AND current_setting('app.scheduler_invoice_pdf_worker_write', true) IS DISTINCT FROM '1'
	THEN
		-- Rolling old processes may still run the generic interrupted-job UPDATE.
		-- Preserve the durable row so the claim worker can resume it instead.
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scheduler_invoice_pdf_failed_write_fence_trigger"
BEFORE UPDATE OF "status" ON "pdf_jobs"
FOR EACH ROW
EXECUTE FUNCTION "scheduler_invoice_pdf_failed_write_fence"();
