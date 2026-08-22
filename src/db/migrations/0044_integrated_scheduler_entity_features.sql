CREATE TABLE "scheduler_invoice_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"currency" text NOT NULL,
	"amount_ex_gst_cents" bigint NOT NULL,
	"gst_amount_cents" bigint NOT NULL,
	"total_inc_gst_cents" bigint NOT NULL,
	"refunded_at" timestamp NOT NULL,
	"reason" text NOT NULL,
	"external_reference" text,
	"created_by_global_user_id" text NOT NULL,
	"created_by_display_name" text,
	"voided_by_global_user_id" text,
	"voided_by_display_name" text,
	"void_reason" text,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_invoice_refunds_status_check" CHECK (
    "scheduler_invoice_refunds"."status" IN ('posted', 'voided')
  ),
	CONSTRAINT "scheduler_invoice_refunds_currency_check" CHECK (
    length(btrim("scheduler_invoice_refunds"."currency")) BETWEEN 1 AND 8
  ),
	CONSTRAINT "scheduler_invoice_refunds_money_check" CHECK (
    "scheduler_invoice_refunds"."amount_ex_gst_cents" >= 0
    AND "scheduler_invoice_refunds"."gst_amount_cents" >= 0
    AND "scheduler_invoice_refunds"."total_inc_gst_cents" > 0
    AND "scheduler_invoice_refunds"."amount_ex_gst_cents" + "scheduler_invoice_refunds"."gst_amount_cents" = "scheduler_invoice_refunds"."total_inc_gst_cents"
  ),
	CONSTRAINT "scheduler_invoice_refunds_text_check" CHECK (
    length(btrim("scheduler_invoice_refunds"."idempotency_key")) BETWEEN 1 AND 200
    AND length(btrim("scheduler_invoice_refunds"."reason")) BETWEEN 1 AND 2000
    AND ("scheduler_invoice_refunds"."external_reference" IS NULL OR char_length("scheduler_invoice_refunds"."external_reference") <= 200)
    AND ("scheduler_invoice_refunds"."void_reason" IS NULL OR length(btrim("scheduler_invoice_refunds"."void_reason")) BETWEEN 1 AND 2000)
  ),
	CONSTRAINT "scheduler_invoice_refunds_void_lifecycle_check" CHECK (
    ("scheduler_invoice_refunds"."status" = 'posted'
      AND "scheduler_invoice_refunds"."voided_by_global_user_id" IS NULL
      AND "scheduler_invoice_refunds"."voided_by_display_name" IS NULL
      AND "scheduler_invoice_refunds"."void_reason" IS NULL
      AND "scheduler_invoice_refunds"."voided_at" IS NULL)
    OR ("scheduler_invoice_refunds"."status" = 'voided'
      AND "scheduler_invoice_refunds"."voided_by_global_user_id" IS NOT NULL
      AND "scheduler_invoice_refunds"."void_reason" IS NOT NULL
      AND "scheduler_invoice_refunds"."voided_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_job_completion_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_app" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"completed_at" timestamp NOT NULL,
	"primary_global_user_id" text,
	"assignee_field_user_id" text,
	"assignee_display_name" text,
	"attribution_source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_job_completion_facts_source_check" CHECK (
    ("scheduler_job_completion_facts"."source_app" = 'ecoaudit' AND "scheduler_job_completion_facts"."source_type" = 'audit')
    OR ("scheduler_job_completion_facts"."source_app" = 'solarsense' AND "scheduler_job_completion_facts"."source_type" = 'assessment')
    OR ("scheduler_job_completion_facts"."source_app" = 'installhub' AND "scheduler_job_completion_facts"."source_type" = 'installation')
  ),
	CONSTRAINT "scheduler_job_completion_facts_attribution_check" CHECK (
    "scheduler_job_completion_facts"."attribution_source" IN (
      'scheduler_event',
      'product_assignment',
      'unattributed'
    )
  )
);
--> statement-breakpoint
CREATE TABLE "scheduler_leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"global_user_id" text NOT NULL,
	"leave_type" text DEFAULT 'annual' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"timezone" text NOT NULL,
	"employee_note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_global_user_id" text,
	"reviewer_note" text,
	"reviewed_at" timestamp,
	"cancelled_by_global_user_id" text,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_leave_requests_type_check" CHECK (
    "scheduler_leave_requests"."leave_type" IN ('annual', 'personal', 'unpaid', 'other')
  ),
	CONSTRAINT "scheduler_leave_requests_date_order_check" CHECK (
    "scheduler_leave_requests"."start_date" <= "scheduler_leave_requests"."end_date"
  ),
	CONSTRAINT "scheduler_leave_requests_timezone_check" CHECK (
    length(btrim("scheduler_leave_requests"."timezone")) BETWEEN 1 AND 100
  ),
	CONSTRAINT "scheduler_leave_requests_status_check" CHECK (
    "scheduler_leave_requests"."status" IN ('pending', 'approved', 'rejected', 'cancelled')
  ),
	CONSTRAINT "scheduler_leave_requests_note_length_check" CHECK (
    ("scheduler_leave_requests"."employee_note" IS NULL OR char_length("scheduler_leave_requests"."employee_note") <= 2000)
    AND ("scheduler_leave_requests"."reviewer_note" IS NULL OR char_length("scheduler_leave_requests"."reviewer_note") <= 2000)
  ),
	CONSTRAINT "scheduler_leave_requests_review_lifecycle_check" CHECK (
    (
      "scheduler_leave_requests"."status" IN ('approved', 'rejected')
      AND "scheduler_leave_requests"."reviewed_by_global_user_id" IS NOT NULL
      AND "scheduler_leave_requests"."reviewed_at" IS NOT NULL
    ) OR (
      "scheduler_leave_requests"."status" IN ('pending', 'cancelled')
      AND (
        ("scheduler_leave_requests"."reviewed_by_global_user_id" IS NULL AND "scheduler_leave_requests"."reviewed_at" IS NULL)
        OR ("scheduler_leave_requests"."reviewed_by_global_user_id" IS NOT NULL AND "scheduler_leave_requests"."reviewed_at" IS NOT NULL)
      )
    )
  ),
	CONSTRAINT "scheduler_leave_requests_cancel_lifecycle_check" CHECK (
    ("scheduler_leave_requests"."status" = 'cancelled'
      AND "scheduler_leave_requests"."cancelled_by_global_user_id" IS NOT NULL
      AND "scheduler_leave_requests"."cancelled_at" IS NOT NULL)
    OR ("scheduler_leave_requests"."status" <> 'cancelled'
      AND "scheduler_leave_requests"."cancelled_by_global_user_id" IS NULL
      AND "scheduler_leave_requests"."cancelled_at" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "global_users" ADD COLUMN "timezone" text DEFAULT 'Australia/Sydney' NOT NULL;--> statement-breakpoint
ALTER TABLE "global_users" ADD COLUMN "working_days_mask" integer DEFAULT 62 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduler_invoice_refunds" ADD CONSTRAINT "scheduler_invoice_refunds_invoice_id_scheduler_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."scheduler_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_invoice_refunds" ADD CONSTRAINT "scheduler_invoice_refunds_created_by_global_user_id_global_users_id_fk" FOREIGN KEY ("created_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_invoice_refunds" ADD CONSTRAINT "scheduler_invoice_refunds_voided_by_global_user_id_global_users_id_fk" FOREIGN KEY ("voided_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD CONSTRAINT "scheduler_job_completion_facts_primary_global_user_id_global_users_id_fk" FOREIGN KEY ("primary_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_leave_requests" ADD CONSTRAINT "scheduler_leave_requests_global_user_id_global_users_id_fk" FOREIGN KEY ("global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_leave_requests" ADD CONSTRAINT "scheduler_leave_requests_reviewed_by_global_user_id_global_users_id_fk" FOREIGN KEY ("reviewed_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_leave_requests" ADD CONSTRAINT "scheduler_leave_requests_cancelled_by_global_user_id_global_users_id_fk" FOREIGN KEY ("cancelled_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_invoice_refunds_invoice_idempotency_unique" ON "scheduler_invoice_refunds" USING btree ("invoice_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "scheduler_invoice_refunds_invoice_status_idx" ON "scheduler_invoice_refunds" USING btree ("invoice_id","status");--> statement-breakpoint
CREATE INDEX "scheduler_invoice_refunds_refunded_currency_idx" ON "scheduler_invoice_refunds" USING btree ("refunded_at","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_job_completion_facts_source_unique" ON "scheduler_job_completion_facts" USING btree ("source_app","source_type","source_id");--> statement-breakpoint
CREATE INDEX "scheduler_job_completion_facts_completed_idx" ON "scheduler_job_completion_facts" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "scheduler_job_completion_facts_user_completed_idx" ON "scheduler_job_completion_facts" USING btree ("primary_global_user_id","completed_at");--> statement-breakpoint
CREATE INDEX "scheduler_leave_requests_user_dates_idx" ON "scheduler_leave_requests" USING btree ("global_user_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "scheduler_leave_requests_status_dates_idx" ON "scheduler_leave_requests" USING btree ("status","start_date","end_date");--> statement-breakpoint
ALTER TABLE "global_users" ADD CONSTRAINT "global_users_timezone_check" CHECK (
    length(btrim("global_users"."timezone")) BETWEEN 1 AND 100
  );--> statement-breakpoint
ALTER TABLE "global_users" ADD CONSTRAINT "global_users_working_days_mask_check" CHECK (
    "global_users"."working_days_mask" BETWEEN 1 AND 127
  );--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD COLUMN "revenue_snapshot_status" text DEFAULT 'unavailable' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD COLUMN "amount_ex_gst_cents" bigint;--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD COLUMN "gst_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD COLUMN "total_inc_gst_cents" bigint;--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD COLUMN "gst_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD COLUMN "revenue_captured_at" timestamp;--> statement-breakpoint
CREATE INDEX "ea_audits_analytics_completed_idx" ON "ea_audits" USING btree ("completed_at") WHERE "ea_audits"."completed_at" IS NOT NULL AND "ea_audits"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ea_audits_analytics_undated_completed_idx" ON "ea_audits" USING btree ("id") WHERE "ea_audits"."status" = 'Completed' AND "ea_audits"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ea_audit_work_sessions_analytics_boundary_idx" ON "ea_audit_work_sessions" USING btree (coalesce("ended_at", "last_active_at"));--> statement-breakpoint
CREATE INDEX "ih_installations_analytics_completed_idx" ON "ih_installations" USING btree ("completed_at") WHERE "ih_installations"."completed_at" IS NOT NULL AND "ih_installations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ih_installations_analytics_undated_completed_idx" ON "ih_installations" USING btree ("id") WHERE "ih_installations"."status" = 'Completed' AND "ih_installations"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ih_installation_work_sessions_analytics_boundary_idx" ON "ih_installation_work_sessions" USING btree (coalesce("ended_at", "last_active_at"));--> statement-breakpoint
CREATE INDEX "scheduler_invoice_refunds_refunded_idx" ON "scheduler_invoice_refunds" USING btree ("refunded_at");--> statement-breakpoint
CREATE INDEX "scheduler_invoice_refunds_voided_idx" ON "scheduler_invoice_refunds" USING btree ("voided_at");--> statement-breakpoint
CREATE INDEX "scheduler_invoices_created_idx" ON "scheduler_invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scheduler_invoices_issued_idx" ON "scheduler_invoices" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "scheduler_invoices_paid_idx" ON "scheduler_invoices" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "scheduler_invoices_voided_idx" ON "scheduler_invoices" USING btree ("voided_at");--> statement-breakpoint
CREATE INDEX "ss_rooftop_assessments_analytics_completed_idx" ON "ss_rooftop_assessments" USING btree ("completed_at") WHERE "ss_rooftop_assessments"."completed_at" IS NOT NULL AND "ss_rooftop_assessments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ss_rooftop_assessments_analytics_undated_completed_idx" ON "ss_rooftop_assessments" USING btree ("id") WHERE "ss_rooftop_assessments"."status" = 'Completed' AND "ss_rooftop_assessments"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ss_assessment_work_sessions_analytics_boundary_idx" ON "ss_assessment_work_sessions" USING btree (coalesce("ended_at", "last_active_at"));--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD CONSTRAINT "scheduler_job_completion_facts_revenue_snapshot_check" CHECK (
    (
      "scheduler_job_completion_facts"."revenue_snapshot_status" = 'unavailable'
      AND "scheduler_job_completion_facts"."currency" IS NULL
      AND "scheduler_job_completion_facts"."amount_ex_gst_cents" IS NULL
      AND "scheduler_job_completion_facts"."gst_amount_cents" IS NULL
      AND "scheduler_job_completion_facts"."total_inc_gst_cents" IS NULL
      AND "scheduler_job_completion_facts"."gst_rate_bps" IS NULL
      AND "scheduler_job_completion_facts"."revenue_captured_at" IS NULL
    ) OR (
      "scheduler_job_completion_facts"."revenue_snapshot_status" IN ('captured', 'incomplete')
      AND "scheduler_job_completion_facts"."currency" IS NOT NULL
      AND length(btrim("scheduler_job_completion_facts"."currency")) BETWEEN 1 AND 8
      AND "scheduler_job_completion_facts"."amount_ex_gst_cents" IS NOT NULL
      AND "scheduler_job_completion_facts"."amount_ex_gst_cents" >= 0
      AND "scheduler_job_completion_facts"."amount_ex_gst_cents" <= 9007199254740991
      AND "scheduler_job_completion_facts"."gst_amount_cents" IS NOT NULL
      AND "scheduler_job_completion_facts"."gst_amount_cents" >= 0
      AND "scheduler_job_completion_facts"."gst_amount_cents" <= 9007199254740991
      AND "scheduler_job_completion_facts"."total_inc_gst_cents" IS NOT NULL
      AND "scheduler_job_completion_facts"."total_inc_gst_cents" <= 9007199254740991
      AND "scheduler_job_completion_facts"."total_inc_gst_cents" = "scheduler_job_completion_facts"."amount_ex_gst_cents" + "scheduler_job_completion_facts"."gst_amount_cents"
      AND "scheduler_job_completion_facts"."gst_rate_bps" IS NOT NULL
      AND "scheduler_job_completion_facts"."gst_rate_bps" BETWEEN 0 AND 10000
      AND "scheduler_job_completion_facts"."revenue_captured_at" IS NOT NULL
      AND "scheduler_job_completion_facts"."gst_amount_cents" = floor(
        ("scheduler_job_completion_facts"."amount_ex_gst_cents"::numeric * "scheduler_job_completion_facts"."gst_rate_bps" + 5000) / 10000
      )
    )
  );--> statement-breakpoint
ALTER TABLE "scheduler_invoice_refunds" DROP CONSTRAINT "scheduler_invoice_refunds_money_check";--> statement-breakpoint
ALTER TABLE "scheduler_invoice_refunds" ADD CONSTRAINT "scheduler_invoice_refunds_money_check" CHECK (
    "scheduler_invoice_refunds"."amount_ex_gst_cents" >= 0
    AND "scheduler_invoice_refunds"."amount_ex_gst_cents" <= 9007199254740991
    AND "scheduler_invoice_refunds"."gst_amount_cents" >= 0
    AND "scheduler_invoice_refunds"."gst_amount_cents" <= 9007199254740991
    AND "scheduler_invoice_refunds"."total_inc_gst_cents" > 0
    AND "scheduler_invoice_refunds"."total_inc_gst_cents" <= 9007199254740991
    AND "scheduler_invoice_refunds"."amount_ex_gst_cents" + "scheduler_invoice_refunds"."gst_amount_cents" = "scheduler_invoice_refunds"."total_inc_gst_cents"
  );--> statement-breakpoint
ALTER TABLE "scheduler_job_completion_facts" ADD CONSTRAINT "scheduler_job_completion_facts_attribution_identity_check" CHECK (
    ("scheduler_job_completion_facts"."attribution_source" = 'unattributed'
      AND "scheduler_job_completion_facts"."primary_global_user_id" IS NULL)
    OR ("scheduler_job_completion_facts"."attribution_source" IN ('scheduler_event', 'product_assignment')
      AND "scheduler_job_completion_facts"."primary_global_user_id" IS NOT NULL)
  );--> statement-breakpoint
-- Preserve every dateable legacy completion before the fact-first analytics
-- path is exposed. Revenue remains unavailable because current finance is not
-- historical evidence. Event attribution wins when its field identity resolves;
-- otherwise product assignment uses origin IDs for Eco/Solar and field IDs for
-- InstallHub. Completed rows without completed_at are deliberately not dated.
WITH legacy_products AS (
  SELECT
    'ecoaudit'::text AS source_app,
    'audit'::text AS source_type,
    audit.id AS source_id,
    audit.completed_at,
    audit.assigned_inspector_user_id AS assigned_product_user_id
  FROM ea_audits audit
  WHERE audit.completed_at IS NOT NULL
  UNION ALL
  SELECT
    'solarsense'::text,
    'assessment'::text,
    assessment.id,
    assessment.completed_at,
    assessment.assigned_inspector_user_id
  FROM ss_rooftop_assessments assessment
  WHERE assessment.completed_at IS NOT NULL
  UNION ALL
  SELECT
    'installhub'::text,
    'installation'::text,
    installation.id,
    installation.completed_at,
    installation.assigned_inspector_user_id
  FROM ih_installations installation
  WHERE installation.completed_at IS NOT NULL
), attributed AS (
  SELECT
    product.*,
    event.assignee_field_user_id AS event_field_user_id,
    event.assignee_display_name AS event_display_name,
    event_identity.id AS event_global_user_id,
    event_identity.full_name AS event_identity_name,
    event_identity.display_email AS event_identity_email,
    product_identity.global_user_id AS product_global_user_id,
    product_identity.field_user_id AS product_field_user_id,
    product_identity.display_name AS product_display_name,
    product_identity.display_email AS product_display_email
  FROM legacy_products product
  LEFT JOIN LATERAL (
    SELECT
      schedule.assignee_field_user_id,
      schedule.assignee_display_name
    FROM portal_schedule_events schedule
    WHERE schedule.source_app = product.source_app
      AND schedule.source_type = product.source_type
      AND schedule.source_id = product.source_id
      AND schedule.status <> 'cancelled'
    ORDER BY
      CASE WHEN schedule.status IN ('planned', 'in_progress') THEN 1 ELSE 0 END DESC,
      schedule.updated_at DESC,
      schedule.id ASC
    LIMIT 1
  ) event ON true
  LEFT JOIN global_users event_identity
    ON event_identity.field_user_id = event.assignee_field_user_id
  LEFT JOIN LATERAL (
    SELECT
      member.global_user_id,
      member.field_user_id,
      member.full_name AS display_name,
      member.email AS display_email
    FROM unified_users member
    WHERE product.source_app IN ('ecoaudit', 'solarsense')
      AND member.origin_app = product.source_app
      AND member.origin_user_id = product.assigned_product_user_id
    UNION ALL
    SELECT
      field_user.id,
      field_user.field_user_id,
      field_user.full_name,
      field_user.display_email
    FROM global_users field_user
    WHERE product.source_app = 'installhub'
      AND field_user.field_user_id = product.assigned_product_user_id
    LIMIT 1
  ) product_identity ON true
)
INSERT INTO scheduler_job_completion_facts (
  id,
  source_app,
  source_type,
  source_id,
  completed_at,
  primary_global_user_id,
  assignee_field_user_id,
  assignee_display_name,
  attribution_source,
  revenue_snapshot_status,
  created_at
)
SELECT
  'completion-backfill-' || md5(
    attributed.source_app || ':' || attributed.source_type || ':' || attributed.source_id
  ),
  attributed.source_app,
  attributed.source_type,
  attributed.source_id,
  attributed.completed_at,
  COALESCE(attributed.event_global_user_id, attributed.product_global_user_id),
  CASE
    WHEN attributed.event_global_user_id IS NOT NULL THEN attributed.event_field_user_id
    WHEN attributed.product_global_user_id IS NOT NULL THEN attributed.product_field_user_id
    ELSE attributed.event_field_user_id
  END,
  CASE
    WHEN attributed.event_global_user_id IS NOT NULL THEN COALESCE(
      NULLIF(btrim(attributed.event_display_name), ''),
      NULLIF(btrim(attributed.event_identity_name), ''),
      attributed.event_identity_email
    )
    WHEN attributed.product_global_user_id IS NOT NULL THEN COALESCE(
      NULLIF(btrim(attributed.product_display_name), ''),
      attributed.product_display_email
    )
    ELSE attributed.event_display_name
  END,
  CASE
    WHEN attributed.event_global_user_id IS NOT NULL THEN 'scheduler_event'
    WHEN attributed.product_global_user_id IS NOT NULL THEN 'product_assignment'
    ELSE 'unattributed'
  END,
  'unavailable',
  now()
FROM attributed
ON CONFLICT (source_app, source_type, source_id) DO NOTHING;--> statement-breakpoint
-- Supersede the rolling-deploy product retention fence from 0034 so a first-
-- completion fact remains authoritative even when an older application binary
-- attempts a direct product delete.
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
    v_blocked := OLD."completed_at" IS NOT NULL
      OR OLD."status" = 'Completed'
      OR EXISTS (
      SELECT 1 FROM "ea_audit_work_sessions" WHERE "audit_id" = OLD."id"
    );
  ELSIF TG_TABLE_NAME = 'ss_rooftop_assessments' THEN
    v_source_app := 'solarsense';
    v_source_type := 'assessment';
    v_blocked := OLD."completed_at" IS NOT NULL
      OR OLD."status" = 'Completed'
      OR EXISTS (
      SELECT 1 FROM "ss_assessment_work_sessions" WHERE "assessment_id" = OLD."id"
    );
  ELSIF TG_TABLE_NAME = 'ih_installations' THEN
    v_source_app := 'installhub';
    v_source_type := 'installation';
    v_blocked := OLD."completed_at" IS NOT NULL
      OR OLD."status" = 'Completed'
      OR EXISTS (
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
          assessment."completed_at" IS NOT NULL
          OR assessment."status" = 'Completed'
          OR EXISTS (
            SELECT 1 FROM "ss_assessment_work_sessions" session
            WHERE session."assessment_id" = assessment."id"
          )
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
          OR EXISTS (
            SELECT 1 FROM "scheduler_job_completion_facts" fact
            WHERE fact."source_app" = 'solarsense'
              AND fact."source_type" = 'assessment'
              AND fact."source_id" = assessment."id"
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
    OR EXISTS (
      SELECT 1 FROM "scheduler_job_completion_facts"
      WHERE "source_app" = v_source_app AND "source_type" = v_source_type
        AND "source_id" = v_source_id
    )
  THEN
    RAISE EXCEPTION 'scheduler_commercial_source_delete_blocked' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_completion_fact_immutability_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scheduler_completion_fact_delete_blocked' USING ERRCODE = '23514';
  END IF;
  RAISE EXCEPTION 'scheduler_completion_fact_immutable' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scheduler_completion_fact_immutability_fence_trigger"
BEFORE UPDATE OR DELETE ON "scheduler_job_completion_facts"
FOR EACH ROW EXECUTE FUNCTION "scheduler_completion_fact_immutability_fence"();--> statement-breakpoint
-- A rolling-deploy writer that predates completion facts must not erase an
-- undated Completed row or turn its next observation into a fabricated date.
-- Dated commercial history may be reopened only after its immutable fact is
-- present. Solar sites have no commercial fact, so their completion boundary
-- remains immutable once observed.
CREATE OR REPLACE FUNCTION "scheduler_product_completion_update_retention_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_app text;
  v_source_type text;
BEGIN
  IF NOT (OLD."status" = 'Completed' OR OLD."completed_at" IS NOT NULL)
    OR (
      NEW."status" IS NOT DISTINCT FROM OLD."status"
      AND NEW."completed_at" IS NOT DISTINCT FROM OLD."completed_at"
    )
  THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ss_sites' THEN
    RAISE EXCEPTION 'scheduler_historical_completion_update_blocked'
      USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'ea_audits' THEN
    v_source_app := 'ecoaudit';
    v_source_type := 'audit';
  ELSIF TG_TABLE_NAME = 'ss_rooftop_assessments' THEN
    v_source_app := 'solarsense';
    v_source_type := 'assessment';
  ELSIF TG_TABLE_NAME = 'ih_installations' THEN
    v_source_app := 'installhub';
    v_source_type := 'installation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "scheduler_job_completion_facts" fact
    WHERE fact."source_app" = v_source_app
      AND fact."source_type" = v_source_type
      AND fact."source_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'scheduler_historical_completion_update_blocked'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ea_audits_completion_update_retention_fence_trigger"
BEFORE UPDATE OF "status", "completed_at" ON "ea_audits"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_completion_update_retention_fence"();--> statement-breakpoint
CREATE TRIGGER "ss_assessments_completion_update_retention_fence_trigger"
BEFORE UPDATE OF "status", "completed_at" ON "ss_rooftop_assessments"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_completion_update_retention_fence"();--> statement-breakpoint
CREATE TRIGGER "ih_installations_completion_update_retention_fence_trigger"
BEFORE UPDATE OF "status", "completed_at" ON "ih_installations"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_completion_update_retention_fence"();--> statement-breakpoint
CREATE TRIGGER "ss_sites_completion_update_retention_fence_trigger"
BEFORE UPDATE OF "status", "completed_at" ON "ss_sites"
FOR EACH ROW EXECUTE FUNCTION "scheduler_product_completion_update_retention_fence"();--> statement-breakpoint
-- Once an invoice has left draft, its header is accounting evidence. Replace
-- the status-column-only 0038 trigger so same-status direct writes cannot
-- rewrite money, currency, identity, source, or lifecycle timestamps.
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
      RAISE EXCEPTION 'scheduler_invoice_insert_lifecycle_invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- Identity and accounting basis never move, even while the invoice is a
  -- draft. Draft edits operate only on mutable presentation and line totals.
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
    RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
      IF NEW."issue_date" IS NOT NULL
        OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" IS NOT NULL
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'issued' THEN
      IF (
        to_jsonb(NEW) - ARRAY[
          'status', 'issue_date', 'due_date', 'seller_name', 'seller_abn',
          'seller_address', 'seller_email', 'job_site_name', 'job_site_address',
          'job_name', 'job_date', 'job_client_name', 'job_status', 'issued_at',
          'updated_at'
        ]
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY[
          'status', 'issue_date', 'due_date', 'seller_name', 'seller_abn',
          'seller_address', 'seller_email', 'job_site_name', 'job_site_address',
          'job_name', 'job_date', 'job_client_name', 'job_status', 'issued_at',
          'updated_at'
        ]
      )
        OR NEW."issue_date" IS NULL
        OR NEW."issued_at" IS NULL
        OR NEW."issued_at" < OLD."created_at"
        OR NEW."issued_at" > timezone('UTC', statement_timestamp())
        OR NEW."due_date" IS NULL
        OR NEW."due_date" < NEW."issue_date"
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" IS NOT NULL
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'void' THEN
      IF (
        to_jsonb(NEW) - ARRAY['status', 'voided_at', 'updated_at']
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['status', 'voided_at', 'updated_at']
      )
        OR NEW."voided_at" IS NULL
        OR NEW."issue_date" IS NOT NULL
        OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" < OLD."created_at"
        OR NEW."voided_at" > timezone('UTC', statement_timestamp())
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'void' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF (
      to_jsonb(NEW) - 'updated_at'
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - 'updated_at'
    )
    THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" IN ('issued', 'paid')
      AND NEW."updated_at" <= OLD."updated_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "scheduler_invoices_lifecycle_fence_trigger"
ON "scheduler_invoices";--> statement-breakpoint
CREATE TRIGGER "scheduler_invoices_lifecycle_fence_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "scheduler_invoices"
FOR EACH ROW EXECUTE FUNCTION "scheduler_invoice_lifecycle_fence"();--> statement-breakpoint
-- Refund inserts take the invoice row lock before becoming visible. Together
-- with the invoice-side posted-refund fence below, this prevents a concurrent
-- direct writer from committing a posted refund against a void invoice.
CREATE OR REPLACE FUNCTION "scheduler_invoice_refund_insert_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice scheduler_invoices%ROWTYPE;
  v_posted_ex_gst numeric;
  v_posted_gst numeric;
  v_posted_total numeric;
  v_remaining_ex_gst numeric;
  v_remaining_gst numeric;
  v_expected_gst numeric;
  v_issue_boundary timestamp;
BEGIN
  IF NEW.status <> 'posted' THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_insert_status_invalid'
      USING ERRCODE = '23514';
  END IF;
  SELECT invoice.*
  INTO v_invoice
  FROM scheduler_invoices invoice
  WHERE invoice.id = NEW.invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_invoice.status NOT IN ('issued', 'paid') THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_invoice_status_invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.currency IS DISTINCT FROM v_invoice.currency THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_currency_mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF v_invoice.subtotal_ex_gst_cents < 0
    OR v_invoice.subtotal_ex_gst_cents > 9007199254740991
    OR v_invoice.gst_amount_cents < 0
    OR v_invoice.gst_amount_cents > 9007199254740991
    OR v_invoice.total_inc_gst_cents < 0
    OR v_invoice.total_inc_gst_cents > 9007199254740991
    OR v_invoice.total_inc_gst_cents::numeric
      <> v_invoice.subtotal_ex_gst_cents::numeric + v_invoice.gst_amount_cents::numeric
    OR v_invoice.gst_rate_bps NOT BETWEEN 0 AND 10000
  THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_invoice_snapshot_invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.amount_ex_gst_cents <= 0
    OR NEW.amount_ex_gst_cents > 9007199254740991
    OR NEW.gst_amount_cents < 0
    OR NEW.gst_amount_cents > 9007199254740991
    OR NEW.total_inc_gst_cents <= 0
    OR NEW.total_inc_gst_cents > 9007199254740991
    OR NEW.total_inc_gst_cents::numeric
      <> NEW.amount_ex_gst_cents::numeric + NEW.gst_amount_cents::numeric
  THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_amount_invalid'
      USING ERRCODE = '23514';
  END IF;
  v_issue_boundary := COALESCE(v_invoice.issued_at, v_invoice.issue_date);
  IF v_issue_boundary IS NULL
    OR NEW.refunded_at < v_issue_boundary
    OR NEW.refunded_at > timezone('UTC', statement_timestamp())
  THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_time_invalid'
      USING ERRCODE = '23514';
  END IF;
  SELECT
    COALESCE(sum(refund.amount_ex_gst_cents::numeric), 0),
    COALESCE(sum(refund.gst_amount_cents::numeric), 0),
    COALESCE(sum(refund.total_inc_gst_cents::numeric), 0)
  INTO v_posted_ex_gst, v_posted_gst, v_posted_total
  FROM scheduler_invoice_refunds refund
  WHERE refund.invoice_id = NEW.invoice_id
    AND refund.status = 'posted';
  v_remaining_ex_gst := v_invoice.subtotal_ex_gst_cents::numeric - v_posted_ex_gst;
  v_remaining_gst := v_invoice.gst_amount_cents::numeric - v_posted_gst;
  IF v_remaining_ex_gst < 0
    OR v_remaining_gst < 0
    OR v_invoice.total_inc_gst_cents::numeric - v_posted_total < 0
    OR NEW.amount_ex_gst_cents::numeric > v_remaining_ex_gst
    OR NEW.gst_amount_cents::numeric > v_remaining_gst
    OR NEW.total_inc_gst_cents::numeric
      > v_invoice.total_inc_gst_cents::numeric - v_posted_total
  THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_capacity_exceeded'
      USING ERRCODE = '23514';
  END IF;
  v_expected_gst := CASE
    WHEN NEW.amount_ex_gst_cents::numeric = v_remaining_ex_gst THEN v_remaining_gst
    ELSE floor(
      (NEW.amount_ex_gst_cents::numeric * v_invoice.gst_rate_bps + 5000) / 10000
    )
  END;
  IF NEW.gst_amount_cents::numeric <> v_expected_gst THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_gst_invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scheduler_invoice_refund_insert_fence_trigger"
BEFORE INSERT ON "scheduler_invoice_refunds"
FOR EACH ROW EXECUTE FUNCTION "scheduler_invoice_refund_insert_fence"();--> statement-breakpoint
-- Refund accounting evidence is append-only. The sole mutation is a forward
-- posted -> voided transition that retains every original field and appends
-- audited reversal fields with a strictly newer revision timestamp.
CREATE OR REPLACE FUNCTION "scheduler_invoice_refund_immutability_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_delete_blocked'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.amount_ex_gst_cents IS DISTINCT FROM OLD.amount_ex_gst_cents
    OR NEW.gst_amount_cents IS DISTINCT FROM OLD.gst_amount_cents
    OR NEW.total_inc_gst_cents IS DISTINCT FROM OLD.total_inc_gst_cents
    OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
    OR NEW.created_by_global_user_id IS DISTINCT FROM OLD.created_by_global_user_id
    OR NEW.created_by_display_name IS DISTINCT FROM OLD.created_by_display_name
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_core_immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'posted' OR NEW.status <> 'voided' THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_lifecycle_immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.voided_at < OLD.refunded_at
    OR NEW.voided_at > timezone('UTC', statement_timestamp())
  THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_void_time_invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'scheduler_invoice_refund_revision_invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scheduler_invoice_refund_immutability_fence_trigger"
BEFORE UPDATE OR DELETE ON "scheduler_invoice_refunds"
FOR EACH ROW EXECUTE FUNCTION "scheduler_invoice_refund_immutability_fence"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "scheduler_invoice_posted_refund_void_fence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'void'
    AND OLD.status IS DISTINCT FROM 'void'
    AND EXISTS (
      SELECT 1
      FROM "scheduler_invoice_refunds" refund
      WHERE refund."invoice_id" = NEW.id
        AND refund.status = 'posted'
    )
  THEN
    RAISE EXCEPTION 'scheduler_invoice_posted_refund_blocks_void'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scheduler_invoice_posted_refund_void_fence_trigger"
BEFORE UPDATE OF "status" ON "scheduler_invoices"
FOR EACH ROW
WHEN (NEW.status = 'void' AND OLD.status IS DISTINCT FROM 'void')
EXECUTE FUNCTION "scheduler_invoice_posted_refund_void_fence"();--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_locality" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_state" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_postcode" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_country_code" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_latitude" double precision;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_longitude" double precision;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_geocode_status" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_geocode_provider" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_geocode_place_id" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_address_fingerprint" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_geocoded_at" timestamp;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_locality" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_state" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_postcode" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_country_code" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_latitude" double precision;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_longitude" double precision;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_geocode_status" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_geocode_provider" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_geocode_place_id" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_address_fingerprint" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_geocoded_at" timestamp;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_locality" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_state" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_postcode" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_country_code" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_latitude" double precision;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_longitude" double precision;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_geocode_status" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_geocode_provider" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_geocode_place_id" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_address_fingerprint" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_geocoded_at" timestamp;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_country_check" CHECK (
    "ea_audits"."site_country_code" IS NULL OR "ea_audits"."site_country_code" = 'AU'
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_state_check" CHECK (
    "ea_audits"."site_state" IS NULL OR "ea_audits"."site_state" IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_postcode_check" CHECK (
    "ea_audits"."site_postcode" IS NULL OR "ea_audits"."site_postcode" ~ '^[0-9]{4}$'
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_coordinates_check" CHECK (
    ("ea_audits"."site_latitude" IS NULL AND "ea_audits"."site_longitude" IS NULL)
    OR (
      "ea_audits"."site_latitude" IS NOT NULL
      AND "ea_audits"."site_longitude" IS NOT NULL
      AND "ea_audits"."site_latitude" BETWEEN -44 AND -9
      AND "ea_audits"."site_longitude" BETWEEN 112 AND 154
    )
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_geocode_status_check" CHECK (
    "ea_audits"."site_geocode_status" IS NULL
    OR "ea_audits"."site_geocode_status" IN ('unresolved', 'resolved', 'manual', 'failed')
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_geocode_evidence_check" CHECK (
    ("ea_audits"."site_geocode_status" IS DISTINCT FROM 'resolved')
    OR ("ea_audits"."site_latitude" IS NOT NULL AND "ea_audits"."site_longitude" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_address_fingerprint_check" CHECK (
    "ea_audits"."site_address_fingerprint" IS NULL
    OR "ea_audits"."site_address_fingerprint" ~ '^[0-9a-f]{64}$'
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_country_check" CHECK (
    "ih_installations"."site_country_code" IS NULL OR "ih_installations"."site_country_code" = 'AU'
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_state_check" CHECK (
    "ih_installations"."site_state" IS NULL OR "ih_installations"."site_state" IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_postcode_check" CHECK (
    "ih_installations"."site_postcode" IS NULL OR "ih_installations"."site_postcode" ~ '^[0-9]{4}$'
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_coordinates_check" CHECK (
    ("ih_installations"."site_latitude" IS NULL AND "ih_installations"."site_longitude" IS NULL)
    OR (
      "ih_installations"."site_latitude" IS NOT NULL
      AND "ih_installations"."site_longitude" IS NOT NULL
      AND "ih_installations"."site_latitude" BETWEEN -44 AND -9
      AND "ih_installations"."site_longitude" BETWEEN 112 AND 154
    )
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_geocode_status_check" CHECK (
    "ih_installations"."site_geocode_status" IS NULL
    OR "ih_installations"."site_geocode_status" IN ('unresolved', 'resolved', 'manual', 'failed')
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_geocode_evidence_check" CHECK (
    ("ih_installations"."site_geocode_status" IS DISTINCT FROM 'resolved')
    OR ("ih_installations"."site_latitude" IS NOT NULL AND "ih_installations"."site_longitude" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_address_fingerprint_check" CHECK (
    "ih_installations"."site_address_fingerprint" IS NULL
    OR "ih_installations"."site_address_fingerprint" ~ '^[0-9a-f]{64}$'
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_country_check" CHECK (
    "ss_sites"."site_country_code" IS NULL OR "ss_sites"."site_country_code" = 'AU'
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_state_check" CHECK (
    "ss_sites"."site_state" IS NULL OR "ss_sites"."site_state" IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_postcode_check" CHECK (
    "ss_sites"."site_postcode" IS NULL OR "ss_sites"."site_postcode" ~ '^[0-9]{4}$'
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_coordinates_check" CHECK (
    ("ss_sites"."site_latitude" IS NULL AND "ss_sites"."site_longitude" IS NULL)
    OR (
      "ss_sites"."site_latitude" IS NOT NULL
      AND "ss_sites"."site_longitude" IS NOT NULL
      AND "ss_sites"."site_latitude" BETWEEN -44 AND -9
      AND "ss_sites"."site_longitude" BETWEEN 112 AND 154
    )
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_geocode_status_check" CHECK (
    "ss_sites"."site_geocode_status" IS NULL
    OR "ss_sites"."site_geocode_status" IN ('unresolved', 'resolved', 'manual', 'failed')
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_geocode_evidence_check" CHECK (
    ("ss_sites"."site_geocode_status" IS DISTINCT FROM 'resolved')
    OR ("ss_sites"."site_latitude" IS NOT NULL AND "ss_sites"."site_longitude" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_address_fingerprint_check" CHECK (
    "ss_sites"."site_address_fingerprint" IS NULL
    OR "ss_sites"."site_address_fingerprint" ~ '^[0-9a-f]{64}$'
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "maas" boolean;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "service_type" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "metering_solution_type" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "planned_meter_type" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_contact_name" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_contact_phone" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_contact_email" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "fergus_job_number" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "quote_number" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "job_comments" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "access_information" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "warranty_device" boolean;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "monitoring_installed" boolean;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "hardware_installed" boolean;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "solar_capacity_kw" double precision;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "additional_monitoring_required" boolean;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "additional_monitoring_hardware" text;--> statement-breakpoint
ALTER TABLE "scheduler_invoices" ADD COLUMN "xero_invoice_number" text;--> statement-breakpoint
ALTER TABLE "scheduler_invoices" ADD COLUMN "xero_date" date;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_customer_name_length_check" CHECK (
    "ih_installations"."customer_name" IS NULL
    OR char_length(btrim("ih_installations"."customer_name")) BETWEEN 1 AND 300
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_service_type_length_check" CHECK (
    "ih_installations"."service_type" IS NULL
    OR char_length(btrim("ih_installations"."service_type")) BETWEEN 1 AND 120
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_metering_solution_type_length_check" CHECK (
    "ih_installations"."metering_solution_type" IS NULL
    OR char_length(btrim("ih_installations"."metering_solution_type")) BETWEEN 1 AND 120
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_planned_meter_type_length_check" CHECK (
    "ih_installations"."planned_meter_type" IS NULL
    OR char_length(btrim("ih_installations"."planned_meter_type")) BETWEEN 1 AND 120
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_contact_name_length_check" CHECK (
    "ih_installations"."site_contact_name" IS NULL
    OR char_length(btrim("ih_installations"."site_contact_name")) BETWEEN 1 AND 300
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_contact_phone_length_check" CHECK (
    "ih_installations"."site_contact_phone" IS NULL
    OR char_length(btrim("ih_installations"."site_contact_phone")) BETWEEN 1 AND 50
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_contact_email_length_check" CHECK (
    "ih_installations"."site_contact_email" IS NULL
    OR char_length(btrim("ih_installations"."site_contact_email")) BETWEEN 1 AND 320
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_fergus_job_number_length_check" CHECK (
    "ih_installations"."fergus_job_number" IS NULL
    OR char_length(btrim("ih_installations"."fergus_job_number")) BETWEEN 1 AND 100
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_quote_number_length_check" CHECK (
    "ih_installations"."quote_number" IS NULL
    OR char_length(btrim("ih_installations"."quote_number")) BETWEEN 1 AND 100
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_job_comments_length_check" CHECK (
    "ih_installations"."job_comments" IS NULL
    OR char_length(btrim("ih_installations"."job_comments")) BETWEEN 1 AND 5000
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_access_information_length_check" CHECK (
    "ih_installations"."access_information" IS NULL
    OR char_length(btrim("ih_installations"."access_information")) BETWEEN 1 AND 5000
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_solar_capacity_kw_check" CHECK (
    "ih_installations"."solar_capacity_kw" IS NULL
    OR ("ih_installations"."solar_capacity_kw" >= 0 AND "ih_installations"."solar_capacity_kw" <= 1000000)
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_additional_monitoring_hardware_length_check" CHECK (
    "ih_installations"."additional_monitoring_hardware" IS NULL
    OR char_length(btrim("ih_installations"."additional_monitoring_hardware")) BETWEEN 1 AND 5000
  );--> statement-breakpoint
ALTER TABLE "scheduler_invoices" ADD CONSTRAINT "scheduler_invoices_xero_invoice_number_check" CHECK (
    "scheduler_invoices"."xero_invoice_number" IS NULL
    OR length(btrim("scheduler_invoices"."xero_invoice_number")) BETWEEN 1 AND 100
  );--> statement-breakpoint
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
      RAISE EXCEPTION 'scheduler_invoice_insert_lifecycle_invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- Internal identity and accounting basis never move. Xero number/date are
  -- deliberately separate reconciliation metadata and may be corrected until void.
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
    RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
      IF NEW."issue_date" IS NOT NULL
        OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" IS NOT NULL
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'issued' THEN
      IF (
        to_jsonb(NEW) - ARRAY[
          'status', 'issue_date', 'due_date', 'seller_name', 'seller_abn',
          'seller_address', 'seller_email', 'job_site_name', 'job_site_address',
          'job_name', 'job_date', 'job_client_name', 'job_status', 'issued_at',
          'updated_at'
        ]
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY[
          'status', 'issue_date', 'due_date', 'seller_name', 'seller_abn',
          'seller_address', 'seller_email', 'job_site_name', 'job_site_address',
          'job_name', 'job_date', 'job_client_name', 'job_status', 'issued_at',
          'updated_at'
        ]
      )
        OR NEW."issue_date" IS NULL
        OR NEW."issued_at" IS NULL
        OR NEW."issued_at" < OLD."created_at"
        OR NEW."issued_at" > timezone('UTC', statement_timestamp())
        OR NEW."due_date" IS NULL
        OR NEW."due_date" < NEW."issue_date"
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" IS NOT NULL
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'void' THEN
      IF (
        to_jsonb(NEW) - ARRAY['status', 'voided_at', 'updated_at']
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['status', 'voided_at', 'updated_at']
      )
        OR NEW."voided_at" IS NULL
        OR NEW."issue_date" IS NOT NULL
        OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" < OLD."created_at"
        OR NEW."voided_at" > timezone('UTC', statement_timestamp())
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'void' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF (
      to_jsonb(NEW) - ARRAY['xero_invoice_number', 'xero_date', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['xero_invoice_number', 'xero_date', 'updated_at']
    )
    THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" IN ('issued', 'paid')
      AND NEW."updated_at" <= OLD."updated_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
ALTER TABLE "ih_grid_supplies" ADD CONSTRAINT "ih_grid_supplies_nmi_length_check" CHECK (
    "ih_grid_supplies"."nmi" IS NULL OR char_length(btrim("ih_grid_supplies"."nmi")) BETWEEN 1 AND 100
  );--> statement-breakpoint
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
      RAISE EXCEPTION 'scheduler_invoice_insert_lifecycle_invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- Internal identity and accounting basis never move. Xero number/date are
  -- deliberately separate reconciliation metadata and may be corrected until void.
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
    RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
      IF NEW."issue_date" IS NOT NULL
        OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" IS NOT NULL
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'issued' THEN
      IF (
        to_jsonb(NEW) - ARRAY[
          'status', 'issue_date', 'due_date', 'seller_name', 'seller_abn',
          'seller_address', 'seller_email', 'job_site_name', 'job_site_address',
          'job_name', 'job_date', 'job_client_name', 'job_status', 'issued_at',
          'updated_at'
        ]
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY[
          'status', 'issue_date', 'due_date', 'seller_name', 'seller_abn',
          'seller_address', 'seller_email', 'job_site_name', 'job_site_address',
          'job_name', 'job_date', 'job_client_name', 'job_status', 'issued_at',
          'updated_at'
        ]
      )
        OR NEW."issue_date" IS NULL
        OR NEW."issued_at" IS NULL
        OR NEW."issued_at" < OLD."created_at"
        OR NEW."issued_at" > timezone('UTC', statement_timestamp())
        OR NEW."due_date" IS NULL
        -- Scheduler timestamps are persisted as UTC-naive values. Compare their
        -- calendar portions so a due date at UTC midnight remains valid all day.
        OR NEW."due_date"::date < NEW."issue_date"::date
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" IS NOT NULL
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'void' THEN
      IF (
        to_jsonb(NEW) - ARRAY['status', 'voided_at', 'updated_at']
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['status', 'voided_at', 'updated_at']
      )
        OR NEW."voided_at" IS NULL
        OR NEW."issue_date" IS NOT NULL
        OR NEW."issued_at" IS NOT NULL
        OR NEW."paid_at" IS NOT NULL
        OR NEW."voided_at" < OLD."created_at"
        OR NEW."voided_at" > timezone('UTC', statement_timestamp())
        OR NEW."updated_at" <= OLD."updated_at"
      THEN
        RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'void' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF (
      to_jsonb(NEW) - ARRAY['xero_invoice_number', 'xero_date', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['xero_invoice_number', 'xero_date', 'updated_at']
    )
    THEN
      RAISE EXCEPTION 'scheduler_invoice_snapshot_immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" IN ('issued', 'paid')
      AND NEW."updated_at" <= OLD."updated_at"
    THEN
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'scheduler_invoice_lifecycle_evidence_invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'scheduler_invoice_status_transition_invalid' USING ERRCODE = '23514';
END;
$$;
