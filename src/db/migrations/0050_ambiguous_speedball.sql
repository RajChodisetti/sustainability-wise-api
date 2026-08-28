CREATE TABLE "scheduler_invoice_settings" (
	"company_key" text PRIMARY KEY NOT NULL,
	"seller_abn" text,
	"updated_by_global_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_invoice_settings_company_key_check" CHECK (
    length(btrim("scheduler_invoice_settings"."company_key")) BETWEEN 1 AND 100
  ),
	CONSTRAINT "scheduler_invoice_settings_seller_abn_check" CHECK (
    "scheduler_invoice_settings"."seller_abn" IS NULL
    OR length(regexp_replace("scheduler_invoice_settings"."seller_abn", '[^0-9]', '', 'g')) = 11
  )
);
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_settings" ADD CONSTRAINT "scheduler_invoice_settings_updated_by_global_user_id_global_users_id_fk" FOREIGN KEY ("updated_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Issued invoices are live working records. Their separately stored PDF artifacts
-- remain append-only evidence, while paid and void invoices stay locked.
CREATE OR REPLACE FUNCTION "scheduler_invoice_lifecycle_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_issue_boundary timestamp;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft'
      OR NEW."issue_date" IS NOT NULL
      OR NEW."issued_at" IS NOT NULL
      OR NEW."paid_at" IS NOT NULL
      OR NEW."voided_at" IS NOT NULL
      OR NEW."updated_at" < NEW."created_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_insert_lifecycle_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'scheduler_invoice_delete_lifecycle_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."finance_id" IS DISTINCT FROM OLD."finance_id"
    OR NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."gst_rate_bps" IS DISTINCT FROM OLD."gst_rate_bps"
    OR NEW."job_source_app" IS DISTINCT FROM OLD."job_source_app"
    OR NEW."job_source_type" IS DISTINCT FROM OLD."job_source_type"
    OR NEW."job_source_id" IS DISTINCT FROM OLD."job_source_id"
    OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
    OR NEW."created_by_display_name" IS DISTINCT FROM OLD."created_by_display_name"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'scheduler_invoice_identity_immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
      IF NEW."issue_date" IS NOT NULL OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL OR NEW."voided_at" IS NOT NULL
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'issued' THEN
      IF NEW."issue_date" IS NULL
        OR NEW."issued_at" IS NULL
        OR NEW."issued_at" < OLD."created_at"
        OR NEW."issued_at" > timezone('UTC', statement_timestamp())
        OR NEW."due_date" IS NULL
        OR NEW."due_date"::date < NEW."issue_date"::date
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" IS NOT NULL
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'void' THEN
      IF NEW."voided_at" IS NULL
        OR NEW."issue_date" IS NOT NULL
        OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" < OLD."created_at"
        OR NEW."voided_at" > timezone('UTC', statement_timestamp())
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'void' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'scheduler_invoice_void_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'issued' AND NEW."status" = 'issued' THEN
    IF NEW."issue_date" IS NULL
      OR NEW."issued_at" IS NULL
      OR NEW."due_date" IS NULL
      OR NEW."due_date"::date < NEW."issue_date"::date
      OR NEW."paid_at" IS NOT NULL
      OR NEW."voided_at" IS NOT NULL
      OR NEW."updated_at" <= OLD."updated_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF (
      to_jsonb(NEW) - ARRAY['xero_invoice_number', 'xero_date', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['xero_invoice_number', 'xero_date', 'updated_at']
    ) OR NEW."updated_at" <= OLD."updated_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_paid_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  v_issue_boundary := COALESCE(OLD."issued_at", OLD."issue_date");
  IF OLD."status" = 'issued' AND NEW."status" = 'paid' THEN
    IF (
      to_jsonb(NEW) - ARRAY['status', 'paid_at', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['status', 'paid_at', 'updated_at']
    )
      OR NEW."paid_at" IS NULL
      OR v_issue_boundary IS NULL
      OR NEW."paid_at" < v_issue_boundary
      OR NEW."paid_at" > timezone('UTC', statement_timestamp())
      OR NEW."updated_at" <= OLD."updated_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'issued' AND NEW."status" = 'void' THEN
    IF (
      to_jsonb(NEW) - ARRAY['status', 'voided_at', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['status', 'voided_at', 'updated_at']
    )
      OR NEW."voided_at" IS NULL
      OR v_issue_boundary IS NULL
      OR NEW."voided_at" < v_issue_boundary
      OR NEW."voided_at" > timezone('UTC', statement_timestamp())
      OR NEW."updated_at" <= OLD."updated_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_invoice_line_reservation_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_status text;
  v_expense_finance_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id"
    OR NEW."finance_id" IS DISTINCT FROM OLD."finance_id"
  ) THEN
    RAISE EXCEPTION 'scheduler_invoice_line_membership_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."finance_id" IS NULL THEN
    SELECT "finance_id" INTO NEW."finance_id"
    FROM "scheduler_invoices" WHERE "id" = NEW."invoice_id";
  END IF;
  PERFORM 1 FROM "scheduler_job_finance" WHERE "id" = NEW."finance_id" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduler_invoice_line_finance_missing' USING ERRCODE = '23503';
  END IF;
  SELECT "status" INTO v_invoice_status
  FROM "scheduler_invoices" WHERE "id" = NEW."invoice_id" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduler_invoice_line_invoice_missing' USING ERRCODE = '23503';
  END IF;
  IF v_invoice_status NOT IN ('draft', 'issued') THEN
    RAISE EXCEPTION 'scheduler_invoice_lines_locked' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "scheduler_invoice_jobs"
    WHERE "invoice_id" = NEW."invoice_id" AND "finance_id" = NEW."finance_id"
  ) THEN
    RAISE EXCEPTION 'scheduler_invoice_line_job_membership_missing' USING ERRCODE = '23503';
  END IF;
  IF NEW."kind" = 'expense' THEN
    SELECT "finance_id" INTO v_expense_finance_id
    FROM "scheduler_job_expenses"
    WHERE "id" = NEW."expense_id" AND "deleted_at" IS NULL;
    IF NOT FOUND OR v_expense_finance_id <> NEW."finance_id" THEN
      RAISE EXCEPTION 'scheduler_invoice_expense_wrong_job' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "scheduler_invoice_lines" AS other_line
      JOIN "scheduler_invoices" AS other_invoice ON other_invoice."id" = other_line."invoice_id"
      WHERE other_line."expense_id" = NEW."expense_id"
        AND other_line."id" IS DISTINCT FROM NEW."id"
        AND other_invoice."status" IN ('draft', 'issued', 'paid')
    ) THEN
      RAISE EXCEPTION 'scheduler_invoice_expense_already_reserved' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_consolidated_invoice_line_delete_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_status text;
BEGIN
  PERFORM 1 FROM "scheduler_job_finance" WHERE "id" = OLD."finance_id" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduler_invoice_line_finance_missing' USING ERRCODE = '23503';
  END IF;
  SELECT "status" INTO v_invoice_status
  FROM "scheduler_invoices" WHERE "id" = OLD."invoice_id" FOR UPDATE;
  IF FOUND AND v_invoice_status NOT IN ('draft', 'issued') THEN
    RAISE EXCEPTION 'scheduler_invoice_lines_locked' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
