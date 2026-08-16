CREATE TABLE "scheduler_invoice_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_value" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_invoice_counters_year_check" CHECK ("scheduler_invoice_counters"."year" BETWEEN 2000 AND 9999),
	CONSTRAINT "scheduler_invoice_counters_value_check" CHECK ("scheduler_invoice_counters"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scheduler_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"unit_amount_ex_gst_cents" bigint DEFAULT 0 NOT NULL,
	"line_total_ex_gst_cents" bigint DEFAULT 0 NOT NULL,
	"expense_id" text,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_invoice_lines_kind_check" CHECK (
    "scheduler_invoice_lines"."kind" IN ('labour', 'expense', 'quoted', 'other')
  ),
	CONSTRAINT "scheduler_invoice_lines_amount_check" CHECK (
    "scheduler_invoice_lines"."quantity" > 0
    AND "scheduler_invoice_lines"."unit_amount_ex_gst_cents" >= 0
    AND "scheduler_invoice_lines"."line_total_ex_gst_cents" >= 0
  ),
	CONSTRAINT "scheduler_invoice_lines_expense_link_check" CHECK (
    ("scheduler_invoice_lines"."kind" = 'expense' AND "scheduler_invoice_lines"."expense_id" IS NOT NULL)
    OR ("scheduler_invoice_lines"."kind" <> 'expense' AND "scheduler_invoice_lines"."expense_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"finance_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"issue_date" timestamp,
	"due_date" timestamp,
	"subtotal_ex_gst_cents" bigint DEFAULT 0 NOT NULL,
	"gst_amount_cents" bigint DEFAULT 0 NOT NULL,
	"total_inc_gst_cents" bigint DEFAULT 0 NOT NULL,
	"gst_rate_bps" integer DEFAULT 1000 NOT NULL,
	"notes" text,
	"seller_name" text NOT NULL,
	"seller_abn" text,
	"seller_address" text,
	"seller_email" text,
	"bill_to_name" text NOT NULL,
	"bill_to_address" text,
	"bill_to_email" text,
	"purchase_order_reference" text,
	"job_site_name" text NOT NULL,
	"job_site_address" text,
	"job_name" text NOT NULL,
	"job_date" text NOT NULL,
	"job_client_name" text,
	"job_status" text NOT NULL,
	"job_source_app" text NOT NULL,
	"job_source_type" text NOT NULL,
	"job_source_id" text NOT NULL,
	"created_by_user_id" text,
	"created_by_display_name" text,
	"issued_at" timestamp,
	"paid_at" timestamp,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_invoices_status_check" CHECK (
    "scheduler_invoices"."status" IN ('draft', 'issued', 'paid', 'void')
  ),
	CONSTRAINT "scheduler_invoices_money_check" CHECK (
    "scheduler_invoices"."subtotal_ex_gst_cents" >= 0
    AND "scheduler_invoices"."gst_amount_cents" >= 0
    AND "scheduler_invoices"."total_inc_gst_cents" >= 0
    AND "scheduler_invoices"."gst_rate_bps" >= 0
  ),
	CONSTRAINT "scheduler_invoices_job_source_check" CHECK (
    ("scheduler_invoices"."job_source_app" = 'ecoaudit' AND "scheduler_invoices"."job_source_type" = 'audit')
    OR ("scheduler_invoices"."job_source_app" = 'solarsense' AND "scheduler_invoices"."job_source_type" = 'assessment')
    OR ("scheduler_invoices"."job_source_app" = 'installhub' AND "scheduler_invoices"."job_source_type" = 'installation')
  ),
	CONSTRAINT "scheduler_invoices_job_date_check" CHECK (
    "scheduler_invoices"."job_date" ~ '^\d{4}-\d{2}-\d{2}$'
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_job_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"finance_id" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"reference" text,
	"cost_amount_cents" bigint NOT NULL,
	"billable_amount_cents" bigint,
	"billable" boolean DEFAULT true NOT NULL,
	"invoiced" boolean DEFAULT false NOT NULL,
	"incurred_at" timestamp,
	"created_by_user_id" text,
	"created_by_display_name" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_job_expenses_kind_check" CHECK (
    "scheduler_job_expenses"."kind" IN ('expense', 'supplier_bill')
  ),
	CONSTRAINT "scheduler_job_expenses_category_check" CHECK (
    "scheduler_job_expenses"."category" IN ('materials', 'travel', 'subcontractor', 'equipment', 'other')
  ),
	CONSTRAINT "scheduler_job_expenses_money_check" CHECK (
    "scheduler_job_expenses"."cost_amount_cents" >= 0
    AND ("scheduler_job_expenses"."billable_amount_cents" IS NULL OR "scheduler_job_expenses"."billable_amount_cents" >= 0)
  ),
	CONSTRAINT "scheduler_job_expenses_description_check" CHECK (
    length(btrim("scheduler_job_expenses"."description")) > 0
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_job_finance" (
	"id" text PRIMARY KEY NOT NULL,
	"source_app" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"pricing_mode" text DEFAULT 'charge_up' NOT NULL,
	"quoted_amount_cents" bigint,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"notes" text,
	"bill_to_name" text,
	"bill_to_address" text,
	"bill_to_email" text,
	"billing_reference" text,
	"billable_rate_cents" bigint DEFAULT 15000 NOT NULL,
	"cost_rate_cents" bigint DEFAULT 7500 NOT NULL,
	"updated_by_user_id" text,
	"updated_by_display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_job_finance_source_check" CHECK (
    ("scheduler_job_finance"."source_app" = 'ecoaudit' AND "scheduler_job_finance"."source_type" = 'audit')
    OR ("scheduler_job_finance"."source_app" = 'solarsense' AND "scheduler_job_finance"."source_type" = 'assessment')
    OR ("scheduler_job_finance"."source_app" = 'installhub' AND "scheduler_job_finance"."source_type" = 'installation')
  ),
	CONSTRAINT "scheduler_job_finance_pricing_mode_check" CHECK (
    "scheduler_job_finance"."pricing_mode" IN ('quoted', 'charge_up')
  ),
	CONSTRAINT "scheduler_job_finance_money_check" CHECK (
    ("scheduler_job_finance"."quoted_amount_cents" IS NULL OR "scheduler_job_finance"."quoted_amount_cents" >= 0)
    AND "scheduler_job_finance"."billable_rate_cents" >= 0
    AND "scheduler_job_finance"."cost_rate_cents" >= 0
  ),
	CONSTRAINT "scheduler_job_finance_currency_check" CHECK (
    length(btrim("scheduler_job_finance"."currency")) BETWEEN 1 AND 8
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_job_hour_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"finance_id" text NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"billable_milliseconds" bigint,
	"cost_milliseconds" bigint,
	"reason" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_job_hour_overrides_revision_check" CHECK ("scheduler_job_hour_overrides"."revision" > 0),
	CONSTRAINT "scheduler_job_hour_overrides_action_check" CHECK (
    "scheduler_job_hour_overrides"."action" IN ('set', 'clear')
  ),
	CONSTRAINT "scheduler_job_hour_overrides_source_check" CHECK (
    "scheduler_job_hour_overrides"."source" IN ('admin', 'legacy_estimate')
  ),
	CONSTRAINT "scheduler_job_hour_overrides_values_check" CHECK (
    (
      "scheduler_job_hour_overrides"."action" = 'set'
      AND ("scheduler_job_hour_overrides"."billable_milliseconds" IS NOT NULL OR "scheduler_job_hour_overrides"."cost_milliseconds" IS NOT NULL)
      AND ("scheduler_job_hour_overrides"."billable_milliseconds" IS NULL OR "scheduler_job_hour_overrides"."billable_milliseconds" >= 0)
      AND ("scheduler_job_hour_overrides"."cost_milliseconds" IS NULL OR "scheduler_job_hour_overrides"."cost_milliseconds" >= 0)
    ) OR (
      "scheduler_job_hour_overrides"."action" = 'clear'
      AND "scheduler_job_hour_overrides"."billable_milliseconds" IS NULL
      AND "scheduler_job_hour_overrides"."cost_milliseconds" IS NULL
    )
  ),
	CONSTRAINT "scheduler_job_hour_overrides_reason_check" CHECK (
    length(btrim("scheduler_job_hour_overrides"."reason")) > 0
  )
);
--> statement-breakpoint
ALTER TABLE "scheduler_invoice_lines" ADD CONSTRAINT "scheduler_invoice_lines_invoice_id_scheduler_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."scheduler_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_invoice_lines" ADD CONSTRAINT "scheduler_invoice_lines_expense_id_scheduler_job_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."scheduler_job_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_invoices" ADD CONSTRAINT "scheduler_invoices_finance_id_scheduler_job_finance_id_fk" FOREIGN KEY ("finance_id") REFERENCES "public"."scheduler_job_finance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_job_expenses" ADD CONSTRAINT "scheduler_job_expenses_finance_id_scheduler_job_finance_id_fk" FOREIGN KEY ("finance_id") REFERENCES "public"."scheduler_job_finance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_job_hour_overrides" ADD CONSTRAINT "scheduler_job_hour_overrides_finance_id_scheduler_job_finance_id_fk" FOREIGN KEY ("finance_id") REFERENCES "public"."scheduler_job_finance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduler_invoice_lines_invoice_idx" ON "scheduler_invoice_lines" USING btree ("invoice_id","sort_order");--> statement-breakpoint
CREATE INDEX "scheduler_invoice_lines_expense_idx" ON "scheduler_invoice_lines" USING btree ("expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_invoices_number_unique" ON "scheduler_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "scheduler_invoices_finance_created_idx" ON "scheduler_invoices" USING btree ("finance_id","created_at");--> statement-breakpoint
CREATE INDEX "scheduler_invoices_finance_status_idx" ON "scheduler_invoices" USING btree ("finance_id","status");--> statement-breakpoint
CREATE INDEX "scheduler_job_expenses_finance_idx" ON "scheduler_job_expenses" USING btree ("finance_id","deleted_at");--> statement-breakpoint
CREATE INDEX "scheduler_job_expenses_invoice_idx" ON "scheduler_job_expenses" USING btree ("finance_id","invoiced");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_job_finance_source_unique" ON "scheduler_job_finance" USING btree ("source_app","source_type","source_id");--> statement-breakpoint
CREATE INDEX "scheduler_job_finance_app_updated_idx" ON "scheduler_job_finance" USING btree ("source_app","updated_at");--> statement-breakpoint
CREATE INDEX "scheduler_job_hour_overrides_finance_created_idx" ON "scheduler_job_hour_overrides" USING btree ("finance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_job_hour_overrides_finance_revision_unique" ON "scheduler_job_hour_overrides" USING btree ("finance_id","revision");
--> statement-breakpoint
-- Accounting data must never be silently clamped or normalized during the
-- legacy conversion. Abort with a clear diagnostic before any shared rows are
-- written when released Field data cannot be represented safely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ea_audit_work_sessions"
    WHERE "active_milliseconds" > floor(extract(epoch FROM ("last_active_at" - "started_at")) * 1000)::bigint + 5000
    UNION ALL
    SELECT 1 FROM "ss_assessment_work_sessions"
    WHERE "active_milliseconds" > floor(extract(epoch FROM ("last_active_at" - "started_at")) * 1000)::bigint + 5000
    UNION ALL
    SELECT 1 FROM "ih_installation_work_sessions"
    WHERE "active_milliseconds" > floor(extract(epoch FROM ("last_active_at" - "started_at")) * 1000)::bigint + 5000
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: active work-session time exceeds its plausible wall-clock span';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_job_finance"
    WHERE "priced_amount" IS NOT NULL
      AND (
        "priced_amount"::text IN ('NaN', 'Infinity', '-Infinity')
        OR "priced_amount" < 0
        OR "priced_amount"::numeric > 90071992547409.91
      )
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy quoted amount is nonfinite, negative, or outside the supported accounting range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_job_cost_lines"
    WHERE "cost_amount"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "cost_amount" < 0
      OR "cost_amount"::numeric > 90071992547409.91
      OR (
        "sell_amount" IS NOT NULL
        AND (
          "sell_amount"::text IN ('NaN', 'Infinity', '-Infinity')
          OR "sell_amount" < 0
          OR "sell_amount"::numeric > 90071992547409.91
        )
      )
      OR (
        "hours" IS NOT NULL
        AND (
          "hours"::text IN ('NaN', 'Infinity', '-Infinity')
          OR "hours" < 0
          OR "hours"::numeric > 2501999792.983608
        )
      )
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy cost line has nonfinite, negative, or out-of-range accounting values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_job_cost_lines"
    WHERE "source" = 'auto_labour'
      AND "hours" > 0
      AND (
        round("cost_amount"::numeric / "hours"::numeric * 100) > 9007199254740991
        OR (
          "sell_amount" IS NOT NULL
          AND round("sell_amount"::numeric / "hours"::numeric * 100) > 9007199254740991
        )
      )
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: derived legacy hourly rate is outside the supported accounting range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_invoices"
    WHERE "subtotal_ex_gst"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "subtotal_ex_gst" < 0
      OR "subtotal_ex_gst"::numeric > 90071992547409.91
      OR "gst_amount"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "gst_amount" < 0
      OR "gst_amount"::numeric > 90071992547409.91
      OR "total_inc_gst"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "total_inc_gst" < 0
      OR "total_inc_gst"::numeric > 90071992547409.91
      OR "gst_rate"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "gst_rate" < 0
      OR "gst_rate"::numeric > 214748.3647
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy invoice has nonfinite, negative, or out-of-range totals';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_invoice_lines"
    WHERE "quantity"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "quantity" <= 0
      OR "unit_amount_ex_gst"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "unit_amount_ex_gst" < 0
      OR "unit_amount_ex_gst"::numeric > 90071992547409.91
      OR "line_total_ex_gst"::text IN ('NaN', 'Infinity', '-Infinity')
      OR "line_total_ex_gst" < 0
      OR "line_total_ex_gst"::numeric > 90071992547409.91
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy invoice line has nonfinite, nonpositive, negative, or out-of-range values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_invoices" invoice
    LEFT JOIN "ih_job_finance" finance
      ON finance."installation_id" = invoice."installation_id"
    WHERE upper(COALESCE(NULLIF(btrim(invoice."currency"), ''), 'AUD'))
      <> upper(COALESCE(NULLIF(btrim(finance."currency"), ''), 'AUD'))
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy invoice currency differs from its job ledger currency';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_invoice_lines" line
    JOIN "ih_invoices" invoice ON invoice."id" = line."invoice_id"
    JOIN "ih_job_cost_lines" cost ON cost."id" = line."cost_line_id"
    WHERE cost."installation_id" <> invoice."installation_id"
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy invoice line references another job ledger';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_job_cost_lines" cost
    WHERE cost."invoiced" = true
      AND NOT EXISTS (
        SELECT 1
        FROM "ih_invoice_lines" line
        JOIN "ih_invoices" invoice ON invoice."id" = line."invoice_id"
        WHERE line."cost_line_id" = cost."id"
          AND invoice."installation_id" = cost."installation_id"
          AND invoice."status" = 'issued'
      )
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy invoiced cost line has no issued invoice snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ih_job_finance" finance
    JOIN (
      SELECT invoice."installation_id", sum(line."line_total_ex_gst"::numeric) AS "reserved_quote"
      FROM "ih_invoice_lines" line
      JOIN "ih_invoices" invoice ON invoice."id" = line."invoice_id"
      JOIN "ih_job_cost_lines" cost ON cost."id" = line."cost_line_id"
      WHERE invoice."status" IN ('draft', 'issued')
        AND cost."source" = 'auto_labour'
      GROUP BY invoice."installation_id"
    ) reservation ON reservation."installation_id" = finance."installation_id"
    WHERE finance."pricing_mode" = 'quoted'
      AND finance."priced_amount" IS NOT NULL
      AND reservation."reserved_quote" > finance."priced_amount"::numeric
  ) THEN
    RAISE EXCEPTION '0033 scheduler finance migration aborted: legacy quoted invoice value exceeds its job quote';
  END IF;
END $$;
--> statement-breakpoint
-- Preserve every legacy Field commercial ledger without changing or dropping
-- the released ih_* tables. The deterministic shared finance id is stable for
-- legacy installations that never had a Scheduler calendar event.
INSERT INTO "scheduler_job_finance" (
  "id", "source_app", "source_type", "source_id", "pricing_mode",
  "quoted_amount_cents", "currency", "notes", "bill_to_name",
  "bill_to_address", "billable_rate_cents", "cost_rate_cents",
  "updated_by_user_id", "created_at", "updated_at"
)
SELECT
  'legacy-installhub:' || legacy."installation_id",
  'installhub',
  'installation',
  legacy."installation_id",
  CASE WHEN header."pricing_mode" = 'quoted' AND header."priced_amount" IS NOT NULL
    THEN 'quoted' ELSE 'charge_up' END,
  CASE WHEN header."priced_amount" IS NULL THEN NULL
    ELSE GREATEST(0, round(header."priced_amount"::numeric * 100))::bigint END,
  upper(COALESCE(NULLIF(btrim(header."currency"), ''), 'AUD')),
  header."notes",
  COALESCE(NULLIF(btrim(installation."client_name"), ''), NULLIF(btrim(installation."site_name"), '')),
  NULLIF(btrim(installation."site_address"), ''),
  COALESCE(auto_rate."billable_rate_cents", 15000),
  COALESCE(auto_rate."cost_rate_cents", 7500),
  header."updated_by_user_id",
  COALESCE(header."created_at", legacy."first_created_at", installation."created_at", now()),
  COALESCE(header."updated_at", legacy."last_updated_at", installation."updated_at", now())
FROM (
  SELECT "installation_id", min("created_at") AS "first_created_at", max("updated_at") AS "last_updated_at"
  FROM (
    SELECT "installation_id", "created_at", "updated_at" FROM "ih_job_finance"
    UNION ALL
    SELECT "installation_id", "created_at", "updated_at" FROM "ih_job_cost_lines"
    UNION ALL
    SELECT "installation_id", "created_at", "updated_at" FROM "ih_invoices"
  ) commercial_rows
  GROUP BY "installation_id"
) legacy
JOIN "ih_installations" installation ON installation."id" = legacy."installation_id"
LEFT JOIN "ih_job_finance" header ON header."installation_id" = legacy."installation_id"
LEFT JOIN LATERAL (
  SELECT
    CASE
      WHEN auto_line."sell_amount" IS NOT NULL
        AND auto_line."sell_amount"::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND auto_line."sell_amount" >= 0
      THEN round(auto_line."sell_amount"::numeric / auto_line."hours"::numeric * 100)::bigint
      ELSE NULL
    END AS "billable_rate_cents",
    CASE
      WHEN auto_line."cost_amount"::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND auto_line."cost_amount" >= 0
      THEN round(auto_line."cost_amount"::numeric / auto_line."hours"::numeric * 100)::bigint
      ELSE NULL
    END AS "cost_rate_cents"
  FROM "ih_job_cost_lines" auto_line
  WHERE auto_line."installation_id" = legacy."installation_id"
    AND auto_line."source" = 'auto_labour'
    AND auto_line."hours"::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND auto_line."hours" > 0
  ORDER BY auto_line."updated_at" DESC, auto_line."id" DESC
  LIMIT 1
) auto_rate ON true
ON CONFLICT ("source_app", "source_type", "source_id") DO NOTHING;
--> statement-breakpoint
-- Manual legacy cost lines become structured ex-GST expenses. The old
-- calendar-day auto_labour estimate is deliberately not copied as an expense,
-- preventing it from being charged in addition to recorded active time.
INSERT INTO "scheduler_job_expenses" (
  "id", "finance_id", "kind", "category", "description", "cost_amount_cents",
  "billable_amount_cents", "billable", "invoiced", "incurred_at",
  "created_by_user_id", "created_at", "updated_at"
)
SELECT
  line."id",
  finance."id",
  'expense',
  CASE line."category"
    WHEN 'material' THEN 'materials'
    WHEN 'labour' THEN 'subcontractor'
    ELSE 'other'
  END,
  line."description",
  GREATEST(0, round(line."cost_amount"::numeric * 100))::bigint,
  CASE WHEN line."sell_amount" IS NULL THEN NULL
    ELSE GREATEST(0, round(line."sell_amount"::numeric * 100))::bigint END,
  line."billable",
  line."invoiced",
  line."incurred_at",
  line."created_by_user_id",
  line."created_at",
  line."updated_at"
FROM "ih_job_cost_lines" line
JOIN "scheduler_job_finance" finance
  ON finance."source_app" = 'installhub'
  AND finance."source_type" = 'installation'
  AND finance."source_id" = line."installation_id"
WHERE line."source" = 'manual'
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- The latest historical auto-labour estimate is retained only when no
-- immutable active work-session evidence exists. This preserves labour cost
-- for issued history as well as uninvoiced work, while remaining visibly
-- marked for admin review and clearable back to recorded actual hours.
INSERT INTO "scheduler_job_hour_overrides" (
  "id", "finance_id", "revision", "action", "source",
  "billable_milliseconds", "cost_milliseconds", "reason",
  "actor_user_id", "actor_display_name", "created_at"
)
SELECT DISTINCT ON (line."installation_id")
  'legacy-hour:' || line."installation_id",
  finance."id",
  1,
  'set',
  'legacy_estimate',
  GREATEST(0, round(COALESCE(line."hours", 0)::numeric * 3600000))::bigint,
  GREATEST(0, round(COALESCE(line."hours", 0)::numeric * 3600000))::bigint,
  'Legacy calendar-day estimate migrated for review',
  'migration:0033',
  'Legacy migration',
  line."updated_at"
FROM "ih_job_cost_lines" line
JOIN "scheduler_job_finance" finance
  ON finance."source_app" = 'installhub'
  AND finance."source_type" = 'installation'
  AND finance."source_id" = line."installation_id"
WHERE line."source" = 'auto_labour'
  AND COALESCE(line."hours", 0) >= 0
  AND NOT EXISTS (
    SELECT 1 FROM "ih_installation_work_sessions" session
    WHERE session."installation_id" = line."installation_id"
      AND session."active_milliseconds" > 0
  )
ORDER BY line."installation_id", line."updated_at" DESC, line."id" DESC
ON CONFLICT ("finance_id", "revision") DO NOTHING;
--> statement-breakpoint
-- Invoice headers are copied as accounting snapshots. Operational source rows
-- are intentionally not referenced by FK, so issued history survives later job
-- edits/deletion.
INSERT INTO "scheduler_invoices" (
  "id", "finance_id", "invoice_number", "status", "currency", "issue_date",
  "due_date", "subtotal_ex_gst_cents", "gst_amount_cents", "total_inc_gst_cents",
  "gst_rate_bps", "notes", "seller_name", "seller_abn", "seller_address",
  "seller_email", "bill_to_name", "bill_to_address", "job_site_name",
  "job_site_address", "job_name", "job_date", "job_client_name", "job_status",
  "job_source_app", "job_source_type", "job_source_id", "created_by_user_id",
  "issued_at", "voided_at", "created_at", "updated_at"
)
SELECT
  invoice."id",
  finance."id",
  invoice."invoice_number",
  CASE WHEN invoice."status" IN ('draft', 'issued', 'void') THEN invoice."status" ELSE 'draft' END,
  upper(COALESCE(NULLIF(btrim(invoice."currency"), ''), finance."currency", 'AUD')),
  invoice."issue_date",
  invoice."due_date",
  GREATEST(0, round(invoice."subtotal_ex_gst"::numeric * 100))::bigint,
  GREATEST(0, round(invoice."gst_amount"::numeric * 100))::bigint,
  GREATEST(0, round(invoice."total_inc_gst"::numeric * 100))::bigint,
  GREATEST(0, round(invoice."gst_rate"::numeric * 10000))::integer,
  invoice."notes",
  COALESCE(NULLIF(btrim(invoice."seller_name"), ''), 'Sustainability Wise'),
  NULLIF(btrim(invoice."seller_abn"), ''),
  NULLIF(btrim(invoice."seller_address"), ''),
  NULLIF(btrim(invoice."seller_email"), ''),
  COALESCE(NULLIF(btrim(installation."client_name"), ''), NULLIF(btrim(installation."site_name"), ''), 'Client'),
  NULLIF(btrim(installation."site_address"), ''),
  COALESCE(NULLIF(btrim(installation."site_name"), ''), 'Field job'),
  NULLIF(btrim(installation."site_address"), ''),
  COALESCE(NULLIF(btrim(installation."site_name"), ''), 'Field job'),
  CASE
    WHEN substring(installation."audit_date" FROM 1 FOR 10)
      ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      AND to_char(to_date(substring(installation."audit_date" FROM 1 FOR 10), 'YYYY-MM-DD'), 'YYYY-MM-DD')
        = substring(installation."audit_date" FROM 1 FOR 10)
      THEN substring(installation."audit_date" FROM 1 FOR 10)
    ELSE COALESCE(installation."created_at", invoice."created_at", now())::date::text
  END,
  NULLIF(btrim(installation."client_name"), ''),
  installation."status",
  'installhub',
  'installation',
  installation."id",
  invoice."created_by_user_id",
  invoice."issued_at",
  invoice."voided_at",
  invoice."created_at",
  invoice."updated_at"
FROM "ih_invoices" invoice
JOIN "ih_installations" installation ON installation."id" = invoice."installation_id"
JOIN "scheduler_job_finance" finance
  ON finance."source_app" = 'installhub'
  AND finance."source_type" = 'installation'
  AND finance."source_id" = invoice."installation_id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "scheduler_invoice_lines" (
  "id", "invoice_id", "sort_order", "kind", "description", "quantity",
  "unit_amount_ex_gst_cents", "line_total_ex_gst_cents", "expense_id",
  "category", "created_at"
)
SELECT
  line."id",
  line."invoice_id",
  line."sort_order",
  CASE
    WHEN cost."source" = 'auto_labour' AND finance."pricing_mode" = 'quoted' THEN 'quoted'
    WHEN cost."source" = 'auto_labour' THEN 'labour'
    WHEN cost."source" = 'manual' THEN 'expense'
    ELSE 'other'
  END,
  line."description",
  line."quantity",
  GREATEST(0, round(line."unit_amount_ex_gst"::numeric * 100))::bigint,
  GREATEST(0, round(line."line_total_ex_gst"::numeric * 100))::bigint,
  CASE WHEN cost."source" = 'manual' THEN expense."id" ELSE NULL END,
  CASE cost."category"
    WHEN 'material' THEN 'materials'
    WHEN 'labour' THEN 'subcontractor'
    WHEN 'other' THEN 'other'
    ELSE NULL
  END,
  line."created_at"
FROM "ih_invoice_lines" line
JOIN "scheduler_invoices" invoice ON invoice."id" = line."invoice_id"
JOIN "scheduler_job_finance" finance ON finance."id" = invoice."finance_id"
LEFT JOIN "ih_job_cost_lines" cost ON cost."id" = line."cost_line_id"
LEFT JOIN "scheduler_job_expenses" expense ON expense."id" = cost."id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Initialize the transaction-safe yearly counter from every preserved invoice
-- number so the first shared allocation cannot collide with legacy history.
INSERT INTO "scheduler_invoice_counters" ("year", "last_value", "updated_at")
SELECT
  substring("invoice_number" FROM '^INV-([0-9]{4})-[0-9]+$')::integer AS "year",
  max(substring("invoice_number" FROM '^INV-[0-9]{4}-([0-9]+)$')::integer) AS "last_value",
  now()
FROM "scheduler_invoices"
WHERE "invoice_number" ~ '^INV-[0-9]{4}-[0-9]+$'
GROUP BY substring("invoice_number" FROM '^INV-([0-9]{4})-[0-9]+$')::integer
ON CONFLICT ("year") DO UPDATE
SET "last_value" = GREATEST("scheduler_invoice_counters"."last_value", EXCLUDED."last_value"),
    "updated_at" = EXCLUDED."updated_at";
