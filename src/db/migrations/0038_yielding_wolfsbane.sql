-- Match the application lock order before taking any table lock used by a
-- finance transaction: finance rows first, then global users/invoices/lines.
DO $$
BEGIN
  PERFORM finance."id"
  FROM "scheduler_job_finance" AS finance
  ORDER BY finance."id"
  FOR UPDATE;
END;
$$;--> statement-breakpoint
-- Keep rolling pre-0038 writers from recreating an active Eco Scheduler link
-- during or after the one-time cutover. Installing the fence first waits out
-- older writers; the following cancellation then sees their committed rows.
CREATE FUNCTION "scheduler_active_source_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_app" = 'ecoaudit'
    AND NEW."status" IN ('planned', 'in_progress')
  THEN
    RAISE EXCEPTION 'scheduler_source_app_disabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "portal_schedule_events_active_source_fence_trigger"
BEFORE INSERT OR UPDATE OF "source_app", "status"
ON "portal_schedule_events"
FOR EACH ROW EXECUTE FUNCTION "scheduler_active_source_fence"();--> statement-breakpoint
-- Eco Audit remains an independent product, but it is no longer a Scheduler
-- source. End only active Scheduler links and notification work; never update
-- the Eco Audit business records or their assignments.
UPDATE "portal_schedule_events"
SET "status" = 'cancelled',
    "cancelled_at" = COALESCE("cancelled_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "source_app" = 'ecoaudit'
  AND "status" IN ('planned', 'in_progress');--> statement-breakpoint
UPDATE "scheduler_notification_jobs"
SET "status" = 'cancelled',
    "claim_token" = NULL,
    "claimed_at" = NULL,
    "completed_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "source_app" = 'ecoaudit'
  AND "status" IN ('queued', 'processing', 'awaiting_receipts');--> statement-breakpoint
UPDATE "scheduler_notification_deliveries" AS delivery
SET "status" = 'failed',
    "last_error" = 'scheduler_source_delinked',
    "completed_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
FROM "scheduler_notification_jobs" AS job
WHERE delivery."job_id" = job."id"
  AND job."source_app" = 'ecoaudit'
  AND delivery."status" IN ('pending', 'ticketed');--> statement-breakpoint
ALTER TABLE "global_users" ADD COLUMN "billing_rate_cents" bigint;--> statement-breakpoint
ALTER TABLE "global_users" ADD CONSTRAINT "global_users_billing_rate_check" CHECK (
    "global_users"."billing_rate_cents" IS NULL OR (
      "global_users"."billing_rate_cents" >= 0
      AND "global_users"."billing_rate_cents" <= 9007199254740991
    )
  );--> statement-breakpoint
-- New and existing draft lines are amount-only unless an admin explicitly opts
-- in. Issued/paid/void snapshots retain their historical presentation.
-- Start with true so existing immutable rows retain their previous Qty/Unit
-- rendering without firing the pre-0038 immutable-line trigger. Flip only the
-- default now; existing draft rows are backfilled after that trigger is replaced.
ALTER TABLE "scheduler_invoice_lines" ADD COLUMN "show_quantity_and_rate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduler_invoice_lines" ALTER COLUMN "show_quantity_and_rate" SET DEFAULT false;--> statement-breakpoint
-- Invoice lifecycle is monotonic. This keeps an old/direct writer from moving
-- an immutable snapshot back to draft and then using the draft-only line path,
-- or deleting an issued/paid/void parent through cascading line deletion.
CREATE FUNCTION "scheduler_invoice_lifecycle_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'draft' AND NEW."status" IN ('issued', 'void') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'issued' AND NEW."status" IN ('paid', 'void') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scheduler_invoices_lifecycle_fence_trigger"
BEFORE UPDATE OF "status" OR DELETE
ON "scheduler_invoices"
FOR EACH ROW EXECUTE FUNCTION "scheduler_invoice_lifecycle_fence"();--> statement-breakpoint
-- Supersede every existing explicit/legacy commercial-hours value with zero.
-- Raw app work sessions remain available as editable evidence and already-issued
-- invoice snapshots remain untouched. Pristine ledgers receive no override so
-- they remain purgeable; the application now treats no override as zero. The
-- finance rows are already locked above in deterministic order.
WITH latest AS (
  SELECT
    hours."finance_id" AS "finance_id",
    MAX(hours."revision") AS "revision"
  FROM "scheduler_job_hour_overrides" AS hours
  GROUP BY hours."finance_id"
)
INSERT INTO "scheduler_job_hour_overrides" (
  "id", "finance_id", "revision", "action", "source",
  "billable_milliseconds", "cost_milliseconds", "reason",
  "actor_user_id", "actor_display_name", "created_at"
)
SELECT
  'hours-zero:' || latest."finance_id",
  latest."finance_id",
  latest."revision" + 1,
  'set',
  'admin',
  0,
  0,
  'Existing commercial hours reset to zero',
  'migration:0038',
  'Legacy migration reset',
  CURRENT_TIMESTAMP
FROM latest;--> statement-breakpoint
-- Invoice lines are editable suggestions while their invoice is a draft.
-- Once issued, paid, or void, the same rows remain immutable snapshots.
CREATE OR REPLACE FUNCTION "scheduler_invoice_line_reservation_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_status text;
  v_expense_finance_id text;
  v_expense_invoiced boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id"
    OR NEW."finance_id" IS DISTINCT FROM OLD."finance_id"
  ) THEN
    RAISE EXCEPTION 'scheduler_invoice_line_membership_immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW."finance_id" IS NULL THEN
    SELECT "finance_id" INTO NEW."finance_id"
    FROM "scheduler_invoices"
    WHERE "id" = NEW."invoice_id";
  END IF;
  PERFORM 1 FROM "scheduler_job_finance"
  WHERE "id" = NEW."finance_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduler_invoice_line_finance_missing' USING ERRCODE = '23503';
  END IF;
  SELECT "status" INTO v_invoice_status
  FROM "scheduler_invoices"
  WHERE "id" = NEW."invoice_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduler_invoice_line_invoice_missing' USING ERRCODE = '23503';
  END IF;
  IF v_invoice_status <> 'draft' THEN
    RAISE EXCEPTION 'scheduler_invoice_lines_immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "scheduler_invoice_jobs"
    WHERE "invoice_id" = NEW."invoice_id" AND "finance_id" = NEW."finance_id"
  ) THEN
    RAISE EXCEPTION 'scheduler_invoice_line_job_membership_missing' USING ERRCODE = '23503';
  END IF;

  IF NEW."kind" = 'expense' THEN
    SELECT "finance_id", "invoiced"
    INTO v_expense_finance_id, v_expense_invoiced
    FROM "scheduler_job_expenses"
    WHERE "id" = NEW."expense_id" AND "deleted_at" IS NULL;
    IF NOT FOUND OR v_expense_finance_id <> NEW."finance_id" THEN
      RAISE EXCEPTION 'scheduler_invoice_expense_wrong_job' USING ERRCODE = '23514';
    END IF;
    IF v_expense_invoiced OR EXISTS (
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
  PERFORM 1 FROM "scheduler_job_finance"
  WHERE "id" = OLD."finance_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduler_invoice_line_finance_missing' USING ERRCODE = '23503';
  END IF;
  SELECT "status" INTO v_invoice_status
  FROM "scheduler_invoices"
  WHERE "id" = OLD."invoice_id"
  FOR UPDATE;
  IF FOUND AND v_invoice_status <> 'draft' THEN
    RAISE EXCEPTION 'scheduler_invoice_lines_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
-- This is a presentation-only backfill. Do not make unrelated legacy expense
-- reservation inconsistencies block the migration while the table is already
-- held exclusively; all later application writes use the restored validator.
ALTER TABLE "scheduler_invoice_lines"
DISABLE TRIGGER "scheduler_invoice_lines_reservation_fence_trigger";--> statement-breakpoint
UPDATE "scheduler_invoice_lines" AS line
SET "show_quantity_and_rate" = false
FROM "scheduler_invoices" AS invoice
WHERE invoice."id" = line."invoice_id"
  AND invoice."status" = 'draft';--> statement-breakpoint
ALTER TABLE "scheduler_invoice_lines"
ENABLE TRIGGER "scheduler_invoice_lines_reservation_fence_trigger";--> statement-breakpoint
-- Commercial job settings feed future suggestions and internal calculations;
-- invoice lines are independent snapshots. Retain only the currency fence.
CREATE OR REPLACE FUNCTION "scheduler_finance_commercial_mutation_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."currency" IS DISTINCT FROM OLD."currency" AND (
    EXISTS (SELECT 1 FROM "scheduler_invoice_jobs" WHERE "finance_id" = OLD."id")
    OR EXISTS (SELECT 1 FROM "scheduler_invoices" WHERE "finance_id" = OLD."id")
    OR EXISTS (SELECT 1 FROM "scheduler_job_expenses" WHERE "finance_id" = OLD."id")
  ) THEN
    RAISE EXCEPTION 'scheduler_finance_currency_locked_by_invoice' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
