CREATE TABLE "scheduler_expense_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"expense_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"storage_key" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	CONSTRAINT "scheduler_expense_attachments_status_check" CHECK ("status" IN ('pending', 'confirmed')),
	CONSTRAINT "scheduler_expense_attachments_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "scheduler_expense_attachments_filename_check" CHECK (length(btrim("filename")) > 0),
	CONSTRAINT "scheduler_expense_attachments_confirmation_check" CHECK (
		("status" = 'pending' AND "confirmed_at" IS NULL)
		OR ("status" = 'confirmed' AND "confirmed_at" IS NOT NULL AND "sha256" ~ '^[0-9a-f]{64}$')
	)
);
--> statement-breakpoint
CREATE TABLE "scheduler_invoice_jobs" (
	"invoice_id" text NOT NULL,
	"finance_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"billing_reference" text,
	"job_site_name" text NOT NULL,
	"job_site_address" text,
	"job_name" text NOT NULL,
	"job_date" text NOT NULL,
	"job_client_name" text,
	"job_status" text NOT NULL,
	"job_source_app" text NOT NULL,
	"job_source_type" text NOT NULL,
	"job_source_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_invoice_jobs_invoice_id_finance_id_pk" PRIMARY KEY("invoice_id","finance_id"),
	CONSTRAINT "scheduler_invoice_jobs_sort_check" CHECK ("sort_order" >= 0),
	CONSTRAINT "scheduler_invoice_jobs_source_check" CHECK (
		("job_source_app" = 'ecoaudit' AND "job_source_type" = 'audit')
		OR ("job_source_app" = 'solarsense' AND "job_source_type" = 'assessment')
		OR ("job_source_app" = 'installhub' AND "job_source_type" = 'installation')
	),
	CONSTRAINT "scheduler_invoice_jobs_date_check" CHECK ("job_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
-- Nullable first: existing invoice lines are backfilled before the final NOT NULL fence.
ALTER TABLE "scheduler_invoice_lines" ADD COLUMN "finance_id" text;
--> statement-breakpoint
ALTER TABLE "scheduler_invoices" ADD COLUMN "bill_to_abn" text;
--> statement-breakpoint
ALTER TABLE "scheduler_job_finance" ADD COLUMN "bill_to_abn" text;
--> statement-breakpoint
ALTER TABLE "scheduler_expense_attachments" ADD CONSTRAINT "scheduler_expense_attachments_expense_id_scheduler_job_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."scheduler_job_expenses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_jobs" ADD CONSTRAINT "scheduler_invoice_jobs_invoice_id_scheduler_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."scheduler_invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_jobs" ADD CONSTRAINT "scheduler_invoice_jobs_finance_id_scheduler_job_finance_id_fk" FOREIGN KEY ("finance_id") REFERENCES "public"."scheduler_job_finance"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Every pre-0034 invoice becomes a one-job invoice without changing its immutable header snapshot.
INSERT INTO "scheduler_invoice_jobs" (
	"invoice_id", "finance_id", "sort_order", "billing_reference",
	"job_site_name", "job_site_address", "job_name", "job_date", "job_client_name",
	"job_status", "job_source_app", "job_source_type", "job_source_id", "created_at"
)
SELECT
	invoice."id", invoice."finance_id", 0, finance."billing_reference",
	invoice."job_site_name", invoice."job_site_address", invoice."job_name", invoice."job_date", invoice."job_client_name",
	invoice."job_status", invoice."job_source_app", invoice."job_source_type", invoice."job_source_id", invoice."created_at"
FROM "scheduler_invoices" AS invoice
JOIN "scheduler_job_finance" AS finance ON finance."id" = invoice."finance_id"
ON CONFLICT ("invoice_id", "finance_id") DO NOTHING;
--> statement-breakpoint
UPDATE "scheduler_invoice_lines" AS line
SET "finance_id" = invoice."finance_id"
FROM "scheduler_invoices" AS invoice
WHERE invoice."id" = line."invoice_id" AND line."finance_id" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "scheduler_invoice_lines" WHERE "finance_id" IS NULL) THEN
		RAISE EXCEPTION 'scheduler_invoice_line_finance_backfill_failed';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_lines" ALTER COLUMN "finance_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_invoice_jobs_invoice_sort_unique" ON "scheduler_invoice_jobs" USING btree ("invoice_id","sort_order");
--> statement-breakpoint
CREATE INDEX "scheduler_invoice_jobs_finance_idx" ON "scheduler_invoice_jobs" USING btree ("finance_id","invoice_id");
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_lines" ADD CONSTRAINT "scheduler_invoice_lines_finance_id_scheduler_job_finance_id_fk" FOREIGN KEY ("finance_id") REFERENCES "public"."scheduler_job_finance"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_lines" ADD CONSTRAINT "scheduler_invoice_lines_invoice_job_fk" FOREIGN KEY ("invoice_id","finance_id") REFERENCES "public"."scheduler_invoice_jobs"("invoice_id","finance_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "scheduler_invoice_lines_finance_idx" ON "scheduler_invoice_lines" USING btree ("finance_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "scheduler_expense_attachments_expense_idx" ON "scheduler_expense_attachments" USING btree ("expense_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_expense_attachments_storage_key_unique" ON "scheduler_expense_attachments" USING btree ("storage_key");
--> statement-breakpoint
-- Rolling compatibility: an old API inserts only the legacy invoice header.
CREATE OR REPLACE FUNCTION "scheduler_seed_invoice_anchor_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO "scheduler_invoice_jobs" (
			"invoice_id", "finance_id", "sort_order", "billing_reference",
			"job_site_name", "job_site_address", "job_name", "job_date", "job_client_name",
			"job_status", "job_source_app", "job_source_type", "job_source_id", "created_at"
		)
		SELECT
			NEW."id", NEW."finance_id", 0, finance."billing_reference",
			NEW."job_site_name", NEW."job_site_address", NEW."job_name", NEW."job_date", NEW."job_client_name",
			NEW."job_status", NEW."job_source_app", NEW."job_source_type", NEW."job_source_id", NEW."created_at"
		FROM "scheduler_job_finance" AS finance
		WHERE finance."id" = NEW."finance_id"
		ON CONFLICT ("invoice_id", "finance_id") DO NOTHING;
	ELSE
		UPDATE "scheduler_invoice_jobs" SET
			"job_site_name" = NEW."job_site_name",
			"job_site_address" = NEW."job_site_address",
			"job_name" = NEW."job_name",
			"job_date" = NEW."job_date",
			"job_client_name" = NEW."job_client_name",
			"job_status" = NEW."job_status",
			"job_source_app" = NEW."job_source_app",
			"job_source_type" = NEW."job_source_type",
			"job_source_id" = NEW."job_source_id"
		WHERE "invoice_id" = NEW."id" AND "finance_id" = NEW."finance_id";
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_invoices_seed_anchor_job_trigger"
AFTER INSERT OR UPDATE OF
	"job_site_name", "job_site_address", "job_name", "job_date", "job_client_name",
	"job_status", "job_source_app", "job_source_type", "job_source_id"
ON "scheduler_invoices"
FOR EACH ROW EXECUTE FUNCTION "scheduler_seed_invoice_anchor_job"();
--> statement-breakpoint
-- Cross-version write fence. It fills finance_id for old line writers, serializes every
-- reservation on the job-finance row, and checks all active lines including consolidated invoices.
CREATE OR REPLACE FUNCTION "scheduler_invoice_line_reservation_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_invoice_status text;
	v_finance "scheduler_job_finance"%ROWTYPE;
	v_override_action text;
	v_override_billable_ms bigint;
	v_effective_ms numeric := 0;
	v_effective_units numeric := 0;
	v_reserved_units numeric := 0;
	v_reserved_quote_cents numeric := 0;
	v_expense_finance_id text;
	v_expense_invoiced boolean;
BEGIN
	IF TG_OP = 'INSERT' AND NEW."kind" = 'other' THEN
		RAISE EXCEPTION 'scheduler_manual_invoice_lines_unsupported' USING ERRCODE = '23514';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF EXISTS (
			SELECT 1 FROM "scheduler_invoices" WHERE "id" = OLD."invoice_id"
		) THEN
			RAISE EXCEPTION 'scheduler_invoice_lines_immutable' USING ERRCODE = '23514';
		END IF;
	END IF;

	SELECT "status" INTO v_invoice_status
	FROM "scheduler_invoices"
	WHERE "id" = NEW."invoice_id";
	IF NOT FOUND THEN
		RAISE EXCEPTION 'scheduler_invoice_line_invoice_missing' USING ERRCODE = '23503';
	END IF;

	IF NEW."finance_id" IS NULL THEN
		SELECT "finance_id" INTO NEW."finance_id"
		FROM "scheduler_invoices"
		WHERE "id" = NEW."invoice_id";
	END IF;

	SELECT * INTO v_finance
	FROM "scheduler_job_finance"
	WHERE "id" = NEW."finance_id"
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'scheduler_invoice_line_finance_missing' USING ERRCODE = '23503';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "scheduler_invoice_jobs"
		WHERE "invoice_id" = NEW."invoice_id" AND "finance_id" = NEW."finance_id"
	) THEN
		RAISE EXCEPTION 'scheduler_invoice_line_job_membership_missing' USING ERRCODE = '23503';
	END IF;

	IF v_invoice_status NOT IN ('draft', 'issued', 'paid') THEN
		RETURN NEW;
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

	IF NEW."kind" = 'quoted' AND v_finance."pricing_mode" = 'quoted' THEN
		SELECT COALESCE(SUM(other_line."line_total_ex_gst_cents"), 0)
		INTO v_reserved_quote_cents
		FROM "scheduler_invoice_lines" AS other_line
		JOIN "scheduler_invoices" AS other_invoice ON other_invoice."id" = other_line."invoice_id"
		WHERE other_line."finance_id" = NEW."finance_id"
			AND other_line."kind" = 'quoted'
			AND other_line."id" IS DISTINCT FROM NEW."id"
			AND other_invoice."status" IN ('draft', 'issued', 'paid');
		IF v_reserved_quote_cents + NEW."line_total_ex_gst_cents" > COALESCE(v_finance."quoted_amount_cents", 0) THEN
			RAISE EXCEPTION 'scheduler_invoice_quote_over_reserved' USING ERRCODE = '23514';
		END IF;
	END IF;

	IF NEW."kind" = 'labour' THEN
		SELECT "action", "billable_milliseconds"
		INTO v_override_action, v_override_billable_ms
		FROM "scheduler_job_hour_overrides"
		WHERE "finance_id" = NEW."finance_id"
		ORDER BY "revision" DESC
		LIMIT 1;

		IF FOUND AND v_override_action = 'set' AND v_override_billable_ms IS NOT NULL THEN
			v_effective_ms := v_override_billable_ms;
		ELSIF v_finance."source_app" = 'ecoaudit' THEN
			SELECT COALESCE(SUM("active_milliseconds"), 0) INTO v_effective_ms
			FROM "ea_audit_work_sessions" WHERE "audit_id" = v_finance."source_id";
		ELSIF v_finance."source_app" = 'solarsense' THEN
			SELECT COALESCE(SUM("active_milliseconds"), 0) INTO v_effective_ms
			FROM "ss_assessment_work_sessions" WHERE "assessment_id" = v_finance."source_id";
		ELSIF v_finance."source_app" = 'installhub' THEN
			SELECT COALESCE(SUM("active_milliseconds"), 0) INTO v_effective_ms
			FROM "ih_installation_work_sessions" WHERE "installation_id" = v_finance."source_id";
		END IF;

		v_effective_units := ROUND(v_effective_ms * 10000 / 3600000);
		SELECT COALESCE(SUM(ROUND(other_line."quantity"::numeric * 10000)), 0)
		INTO v_reserved_units
		FROM "scheduler_invoice_lines" AS other_line
		JOIN "scheduler_invoices" AS other_invoice ON other_invoice."id" = other_line."invoice_id"
		WHERE other_line."finance_id" = NEW."finance_id"
			AND other_line."kind" = 'labour'
			AND other_line."id" IS DISTINCT FROM NEW."id"
			AND other_invoice."status" IN ('draft', 'issued', 'paid');
		IF v_reserved_units + ROUND(NEW."quantity"::numeric * 10000) > v_effective_units THEN
			RAISE EXCEPTION 'scheduler_invoice_labour_over_reserved' USING ERRCODE = '23514';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_invoice_lines_reservation_fence_trigger"
BEFORE INSERT OR UPDATE
ON "scheduler_invoice_lines"
FOR EACH ROW EXECUTE FUNCTION "scheduler_invoice_line_reservation_fence"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_consolidated_invoice_line_delete_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "scheduler_invoices" WHERE "id" = OLD."invoice_id"
	) THEN
		RAISE EXCEPTION 'scheduler_invoice_lines_immutable' USING ERRCODE = '23514';
	END IF;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_invoice_lines_consolidated_delete_fence_trigger"
BEFORE DELETE ON "scheduler_invoice_lines"
FOR EACH ROW EXECUTE FUNCTION "scheduler_consolidated_invoice_line_delete_fence"();
--> statement-breakpoint
-- Old application instances only understand the anchor finance_id and can
-- otherwise issue/void/pay a consolidated invoice as if it were one job. New
-- lifecycle transactions opt in with a transaction-local marker after taking
-- all invoice/job locks. The marker intentionally disappears at commit.
CREATE OR REPLACE FUNCTION "scheduler_consolidated_invoice_status_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."status" IS DISTINCT FROM OLD."status"
		AND (
			SELECT count(*) FROM "scheduler_invoice_jobs"
			WHERE "invoice_id" = OLD."id"
		) > 1
		AND current_setting('sustainability.scheduler_multi_job_writer', true) IS DISTINCT FROM 'on'
	THEN
		RAISE EXCEPTION 'scheduler_consolidated_invoice_status_requires_current_writer'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_invoices_consolidated_status_fence_trigger"
BEFORE UPDATE OF "status" ON "scheduler_invoices"
FOR EACH ROW EXECUTE FUNCTION "scheduler_consolidated_invoice_status_fence"();
--> statement-breakpoint
-- Old application instances only inspect scheduler_invoices.finance_id. Guard secondary
-- consolidated ledgers at the database boundary during rolling deploy and rollback.
CREATE OR REPLACE FUNCTION "scheduler_finance_commercial_mutation_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_reserved_quote_cents numeric := 0;
BEGIN
	IF NEW."currency" IS DISTINCT FROM OLD."currency" AND (
		EXISTS (SELECT 1 FROM "scheduler_invoice_jobs" WHERE "finance_id" = OLD."id")
		OR EXISTS (SELECT 1 FROM "scheduler_invoices" WHERE "finance_id" = OLD."id")
		OR EXISTS (SELECT 1 FROM "scheduler_job_expenses" WHERE "finance_id" = OLD."id")
	) THEN
		RAISE EXCEPTION 'scheduler_finance_currency_locked_by_invoice' USING ERRCODE = '23514';
	END IF;

	IF (
		NEW."pricing_mode" IS DISTINCT FROM OLD."pricing_mode"
		OR NEW."quoted_amount_cents" IS DISTINCT FROM OLD."quoted_amount_cents"
		OR NEW."billable_rate_cents" IS DISTINCT FROM OLD."billable_rate_cents"
		OR NEW."cost_rate_cents" IS DISTINCT FROM OLD."cost_rate_cents"
	) AND EXISTS (
		SELECT 1
		FROM "scheduler_invoice_jobs" AS job
		JOIN "scheduler_invoices" AS invoice ON invoice."id" = job."invoice_id"
		WHERE job."finance_id" = OLD."id" AND invoice."status" IN ('draft', 'issued', 'paid')
	) THEN
		RAISE EXCEPTION 'scheduler_finance_rates_locked_by_invoice' USING ERRCODE = '23514';
	END IF;

	IF NEW."pricing_mode" = 'quoted' THEN
		SELECT COALESCE(SUM(line."line_total_ex_gst_cents"), 0)
		INTO v_reserved_quote_cents
		FROM "scheduler_invoice_lines" AS line
		JOIN "scheduler_invoices" AS invoice ON invoice."id" = line."invoice_id"
		WHERE line."finance_id" = OLD."id"
			AND line."kind" = 'quoted'
			AND invoice."status" IN ('draft', 'issued', 'paid');
		IF v_reserved_quote_cents > COALESCE(NEW."quoted_amount_cents", 0) THEN
			RAISE EXCEPTION 'scheduler_finance_quote_below_reservations' USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_job_finance_commercial_mutation_fence_trigger"
BEFORE UPDATE OF "currency", "pricing_mode", "quoted_amount_cents", "billable_rate_cents", "cost_rate_cents"
ON "scheduler_job_finance"
FOR EACH ROW EXECUTE FUNCTION "scheduler_finance_commercial_mutation_fence"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_expense_reservation_mutation_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_expense_id text;
	v_business_changed boolean := TG_OP = 'DELETE';
BEGIN
	IF TG_OP = 'DELETE' THEN
		v_expense_id := OLD."id";
	ELSE
		v_expense_id := NEW."id";
		v_business_changed :=
			NEW."kind" IS DISTINCT FROM OLD."kind"
			OR NEW."category" IS DISTINCT FROM OLD."category"
			OR NEW."description" IS DISTINCT FROM OLD."description"
			OR NEW."vendor" IS DISTINCT FROM OLD."vendor"
			OR NEW."reference" IS DISTINCT FROM OLD."reference"
			OR NEW."cost_amount_cents" IS DISTINCT FROM OLD."cost_amount_cents"
			OR NEW."billable_amount_cents" IS DISTINCT FROM OLD."billable_amount_cents"
			OR NEW."billable" IS DISTINCT FROM OLD."billable"
			OR NEW."incurred_at" IS DISTINCT FROM OLD."incurred_at"
			OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at";
	END IF;
	IF v_business_changed AND EXISTS (
		SELECT 1
		FROM "scheduler_invoice_lines" AS line
		JOIN "scheduler_invoices" AS invoice ON invoice."id" = line."invoice_id"
		WHERE line."expense_id" = v_expense_id
			AND invoice."status" IN ('draft', 'issued', 'paid')
	) THEN
		RAISE EXCEPTION 'scheduler_expense_locked_by_invoice' USING ERRCODE = '23514';
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_job_expenses_reservation_mutation_fence_trigger"
BEFORE UPDATE OR DELETE ON "scheduler_job_expenses"
FOR EACH ROW EXECUTE FUNCTION "scheduler_expense_reservation_mutation_fence"();
--> statement-breakpoint
-- Hard-purge rolling compatibility. Pre-0034 Eco/Solar binaries have no
-- Scheduler retention check and the old InstallHub check can remove an edited
-- ledger. These database fences preserve source/time/commercial evidence even
-- while an old process is being drained. The current purge service first locks
-- the source, rejects every evidence row/event, and removes only a provably
-- pristine auto-created ledger, so an authorized evidence-free purge still
-- reaches the parent DELETE with no retained commercial rows.
CREATE OR REPLACE FUNCTION "scheduler_finance_delete_retention_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_source_active boolean := false;
	v_has_event boolean := false;
	v_pristine boolean := false;
BEGIN
	IF current_setting('sustainability.scheduler_purge_writer', true) = 'on' THEN
		RETURN OLD;
	END IF;

	IF OLD."source_app" = 'ecoaudit' THEN
		SELECT EXISTS (SELECT 1 FROM "ea_audits" WHERE "id" = OLD."source_id")
		INTO v_source_active;
	ELSIF OLD."source_app" = 'solarsense' THEN
		SELECT EXISTS (SELECT 1 FROM "ss_rooftop_assessments" WHERE "id" = OLD."source_id")
		INTO v_source_active;
	ELSIF OLD."source_app" = 'installhub' THEN
		SELECT EXISTS (SELECT 1 FROM "ih_installations" WHERE "id" = OLD."source_id")
		INTO v_source_active;
	END IF;

	IF NOT v_source_active THEN RETURN OLD; END IF;

	SELECT EXISTS (
		SELECT 1 FROM "portal_schedule_events"
		WHERE "source_app" = OLD."source_app"
			AND "source_type" = OLD."source_type"
			AND "source_id" = OLD."source_id"
	) INTO v_has_event;

	v_pristine :=
		OLD."created_at" = OLD."updated_at"
		AND OLD."updated_by_user_id" IS NULL
		AND OLD."updated_by_display_name" IS NULL
		AND OLD."pricing_mode" = 'charge_up'
		AND OLD."quoted_amount_cents" IS NULL
		AND OLD."currency" = 'AUD'
		AND OLD."notes" IS NULL
		AND OLD."bill_to_abn" IS NULL
		AND OLD."bill_to_email" IS NULL
		AND OLD."billing_reference" IS NULL
		AND OLD."billable_rate_cents" = 15000
		AND OLD."cost_rate_cents" = 7500;

	IF v_has_event OR NOT v_pristine
		OR EXISTS (SELECT 1 FROM "scheduler_job_hour_overrides" WHERE "finance_id" = OLD."id")
		OR EXISTS (SELECT 1 FROM "scheduler_job_expenses" WHERE "finance_id" = OLD."id")
		OR EXISTS (SELECT 1 FROM "scheduler_invoice_jobs" WHERE "finance_id" = OLD."id")
		OR EXISTS (SELECT 1 FROM "scheduler_invoices" WHERE "finance_id" = OLD."id")
	THEN
		RAISE EXCEPTION 'scheduler_commercial_evidence_delete_blocked' USING ERRCODE = '23514';
	END IF;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "scheduler_job_finance_delete_retention_fence_trigger"
BEFORE DELETE ON "scheduler_job_finance"
FOR EACH ROW EXECUTE FUNCTION "scheduler_finance_delete_retention_fence"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_work_session_delete_retention_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_parent_exists boolean := false;
BEGIN
	IF TG_TABLE_NAME = 'ea_audit_work_sessions' THEN
		SELECT EXISTS (SELECT 1 FROM "ea_audits" WHERE "id" = OLD."audit_id")
		INTO v_parent_exists;
	ELSIF TG_TABLE_NAME = 'ss_assessment_work_sessions' THEN
		SELECT EXISTS (SELECT 1 FROM "ss_rooftop_assessments" WHERE "id" = OLD."assessment_id")
		INTO v_parent_exists;
	ELSIF TG_TABLE_NAME = 'ih_installation_work_sessions' THEN
		SELECT EXISTS (SELECT 1 FROM "ih_installations" WHERE "id" = OLD."installation_id")
		INTO v_parent_exists;
	END IF;
	IF v_parent_exists THEN
		RAISE EXCEPTION 'scheduler_work_session_delete_blocked' USING ERRCODE = '23514';
	END IF;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ea_audit_work_sessions_delete_retention_fence_trigger"
BEFORE DELETE ON "ea_audit_work_sessions"
FOR EACH ROW EXECUTE FUNCTION "scheduler_work_session_delete_retention_fence"();
--> statement-breakpoint
CREATE TRIGGER "ss_assessment_work_sessions_delete_retention_fence_trigger"
BEFORE DELETE ON "ss_assessment_work_sessions"
FOR EACH ROW EXECUTE FUNCTION "scheduler_work_session_delete_retention_fence"();
--> statement-breakpoint
CREATE TRIGGER "ih_installation_work_sessions_delete_retention_fence_trigger"
BEFORE DELETE ON "ih_installation_work_sessions"
FOR EACH ROW EXECUTE FUNCTION "scheduler_work_session_delete_retention_fence"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_product_source_delete_retention_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_source_app text;
	v_source_type text;
	v_source_id text := OLD."id";
	v_blocked boolean := false;
BEGIN
	IF TG_TABLE_NAME = 'ea_audits' THEN
		v_source_app := 'ecoaudit';
		v_source_type := 'audit';
		v_blocked := EXISTS (
			SELECT 1 FROM "ea_audit_work_sessions" WHERE "audit_id" = OLD."id"
		);
	ELSIF TG_TABLE_NAME = 'ss_rooftop_assessments' THEN
		v_source_app := 'solarsense';
		v_source_type := 'assessment';
		v_blocked := EXISTS (
			SELECT 1 FROM "ss_assessment_work_sessions" WHERE "assessment_id" = OLD."id"
		);
	ELSIF TG_TABLE_NAME = 'ih_installations' THEN
		v_source_app := 'installhub';
		v_source_type := 'installation';
		v_blocked := EXISTS (
			SELECT 1 FROM "ih_installation_work_sessions" WHERE "installation_id" = OLD."id"
		);
	ELSIF TG_TABLE_NAME = 'ss_sites' THEN
		IF EXISTS (
			SELECT 1 FROM "portal_schedule_events"
			WHERE "source_app" = 'solarsense' AND "source_type" = 'site'
				AND "source_id" = OLD."id"
		) OR EXISTS (
			SELECT 1
			FROM "ss_rooftop_assessments" AS assessment
			WHERE assessment."site_id" = OLD."id"
				AND (
					EXISTS (SELECT 1 FROM "ss_assessment_work_sessions" session WHERE session."assessment_id" = assessment."id")
					OR EXISTS (
						SELECT 1 FROM "portal_schedule_events" event
						WHERE event."source_app" = 'solarsense'
							AND event."source_type" = 'assessment'
							AND event."source_id" = assessment."id"
					)
					OR EXISTS (
						SELECT 1 FROM "scheduler_job_finance" finance
						WHERE finance."source_app" = 'solarsense'
							AND finance."source_type" = 'assessment'
							AND finance."source_id" = assessment."id"
					)
				)
		) THEN
			RAISE EXCEPTION 'scheduler_commercial_source_delete_blocked' USING ERRCODE = '23514';
		END IF;
		RETURN OLD;
	END IF;

	IF v_blocked
		OR EXISTS (
			SELECT 1 FROM "portal_schedule_events"
			WHERE "source_app" = v_source_app AND "source_type" = v_source_type
				AND "source_id" = v_source_id
		)
		OR EXISTS (
			SELECT 1 FROM "scheduler_job_finance"
			WHERE "source_app" = v_source_app AND "source_type" = v_source_type
				AND "source_id" = v_source_id
		)
	THEN
		RAISE EXCEPTION 'scheduler_commercial_source_delete_blocked' USING ERRCODE = '23514';
	END IF;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ea_audits_delete_retention_fence_trigger"
BEFORE DELETE ON "ea_audits"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_source_delete_retention_fence"();
--> statement-breakpoint
CREATE TRIGGER "ss_rooftop_assessments_delete_retention_fence_trigger"
BEFORE DELETE ON "ss_rooftop_assessments"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_source_delete_retention_fence"();
--> statement-breakpoint
CREATE TRIGGER "ss_sites_delete_retention_fence_trigger"
BEFORE DELETE ON "ss_sites"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_source_delete_retention_fence"();
--> statement-breakpoint
CREATE TRIGGER "ih_installations_delete_retention_fence_trigger"
BEFORE DELETE ON "ih_installations"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_source_delete_retention_fence"();
