CREATE TABLE "ww_meter_register_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"source_key" text NOT NULL,
	"source_row" integer NOT NULL,
	"source_row_sha256" text NOT NULL,
	"status_snapshot" text,
	"customer_name_snapshot" text,
	"client_name_snapshot" text,
	"site_address_snapshot" text,
	"site_state_snapshot" text,
	"service_type_snapshot" text,
	"metering_solution_type_snapshot" text,
	"meter_type_snapshot" text,
	"fergus_job_number_snapshot" text,
	"quote_number_snapshot" text,
	"purchase_order_number_snapshot" text,
	"job_completion_date" date,
	"job_completed_by_snapshot" text,
	"existing_device_identifier" text,
	"new_device_identifier" text,
	"current_device_identifier" text,
	"existing_device_classification" text NOT NULL,
	"new_device_classification" text NOT NULL,
	"current_device_classification" text NOT NULL,
	"existing_wattwatchers_device_id" text,
	"new_wattwatchers_device_id" text,
	"current_wattwatchers_device_id" text,
	"hardware_installed_snapshot" text,
	"maas" boolean,
	"maas_start_date" date,
	"maas_term_snapshot" text,
	"maas_reporting_required" boolean,
	"data_enabled" boolean,
	"product_name_snapshot" text,
	"xero_invoice_number_snapshot" text,
	"meter_cost_ex_gst_cents" bigint,
	"metering_recurring_fee_ex_gst_cents" bigint,
	"other_invoice_costs_ex_gst_cents" bigint,
	"invoice_amount_ex_gst_cents" bigint,
	"recurring_fee_po_snapshot" text,
	"invoicing_client_contact_snapshot" text,
	"comments_snapshot" text,
	"recurring_start_date" date,
	"recurring_frequency_snapshot" text,
	"recurring_next_invoice_issue_date" date,
	"invoice_issued_date" date,
	"billing_period_snapshot" text,
	"issued_period_next_invoice_issue_date" date,
	"source_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ww_meter_register_entries_source_check" CHECK (
    "ww_meter_register_entries"."source_row" >= 2
    AND char_length(btrim("ww_meter_register_entries"."source_key")) >= 1
    AND char_length("ww_meter_register_entries"."source_row_sha256") = 64
    AND "ww_meter_register_entries"."source_row_sha256" ~ '^[0-9a-f]{64}$'
  ),
	CONSTRAINT "ww_meter_register_entries_classification_check" CHECK (
    "ww_meter_register_entries"."existing_device_classification" IN ('absent', 'confirmed_wattwatchers', 'candidate_wattwatchers', 'other_hardware')
    AND "ww_meter_register_entries"."new_device_classification" IN ('absent', 'confirmed_wattwatchers', 'candidate_wattwatchers', 'other_hardware')
    AND "ww_meter_register_entries"."current_device_classification" IN ('absent', 'confirmed_wattwatchers', 'candidate_wattwatchers', 'other_hardware')
  ),
	CONSTRAINT "ww_meter_register_entries_identifier_check" CHECK (
    (("ww_meter_register_entries"."existing_device_identifier" IS NULL) = ("ww_meter_register_entries"."existing_device_classification" = 'absent'))
    AND (("ww_meter_register_entries"."new_device_identifier" IS NULL) = ("ww_meter_register_entries"."new_device_classification" = 'absent'))
    AND (("ww_meter_register_entries"."current_device_identifier" IS NULL) = ("ww_meter_register_entries"."current_device_classification" = 'absent'))
    AND "ww_meter_register_entries"."current_device_identifier" IS NOT DISTINCT FROM coalesce(
      "ww_meter_register_entries"."new_device_identifier",
      "ww_meter_register_entries"."existing_device_identifier"
    )
    AND "ww_meter_register_entries"."current_device_classification" = CASE
      WHEN "ww_meter_register_entries"."new_device_identifier" IS NOT NULL THEN "ww_meter_register_entries"."new_device_classification"
      WHEN "ww_meter_register_entries"."existing_device_identifier" IS NOT NULL THEN "ww_meter_register_entries"."existing_device_classification"
      ELSE 'absent'
    END
	),
	CONSTRAINT "ww_meter_register_entries_device_link_check" CHECK (
    (("ww_meter_register_entries"."existing_wattwatchers_device_id" IS NULL) = ("ww_meter_register_entries"."existing_device_classification" <> 'confirmed_wattwatchers'))
    AND (("ww_meter_register_entries"."new_wattwatchers_device_id" IS NULL) = ("ww_meter_register_entries"."new_device_classification" <> 'confirmed_wattwatchers'))
    AND (("ww_meter_register_entries"."current_wattwatchers_device_id" IS NULL) = ("ww_meter_register_entries"."current_device_classification" <> 'confirmed_wattwatchers'))
    AND "ww_meter_register_entries"."current_wattwatchers_device_id" IS NOT DISTINCT FROM CASE
      WHEN "ww_meter_register_entries"."new_device_identifier" IS NOT NULL THEN "ww_meter_register_entries"."new_wattwatchers_device_id"
      ELSE "ww_meter_register_entries"."existing_wattwatchers_device_id"
    END
  )
);
--> statement-breakpoint
CREATE TABLE "ww_meter_register_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"workbook_sha256" text NOT NULL,
	"source_row_count" integer NOT NULL,
	"device_value_count" integer NOT NULL,
	"unique_identifier_count" integer NOT NULL,
	"confirmed_wattwatchers_identifier_count" integer NOT NULL,
	"candidate_wattwatchers_identifier_count" integer NOT NULL,
	"other_hardware_identifier_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ww_meter_register_imports_source_check" CHECK (
    char_length(btrim("ww_meter_register_imports"."source_workbook")) >= 1
    AND char_length(btrim("ww_meter_register_imports"."source_sheet")) >= 1
    AND char_length("ww_meter_register_imports"."workbook_sha256") = 64
    AND "ww_meter_register_imports"."workbook_sha256" ~ '^[0-9a-f]{64}$'
  ),
	CONSTRAINT "ww_meter_register_imports_counts_check" CHECK (
    "ww_meter_register_imports"."source_row_count" >= 0
    AND "ww_meter_register_imports"."device_value_count" >= 0
    AND "ww_meter_register_imports"."unique_identifier_count" >= 0
    AND "ww_meter_register_imports"."unique_identifier_count" <= "ww_meter_register_imports"."device_value_count"
    AND "ww_meter_register_imports"."confirmed_wattwatchers_identifier_count" >= 0
    AND "ww_meter_register_imports"."candidate_wattwatchers_identifier_count" >= 0
    AND "ww_meter_register_imports"."other_hardware_identifier_count" >= 0
    AND "ww_meter_register_imports"."confirmed_wattwatchers_identifier_count"
      + "ww_meter_register_imports"."candidate_wattwatchers_identifier_count"
      + "ww_meter_register_imports"."other_hardware_identifier_count" = "ww_meter_register_imports"."unique_identifier_count"
  )
);
--> statement-breakpoint
ALTER TABLE "ww_meter_register_entries" ADD CONSTRAINT "ww_meter_register_entries_import_fk" FOREIGN KEY ("import_id") REFERENCES "public"."ww_meter_register_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_meter_register_entries" ADD CONSTRAINT "ww_meter_register_entries_existing_device_fk" FOREIGN KEY ("existing_wattwatchers_device_id") REFERENCES "public"."ww_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_meter_register_entries" ADD CONSTRAINT "ww_meter_register_entries_new_device_fk" FOREIGN KEY ("new_wattwatchers_device_id") REFERENCES "public"."ww_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_meter_register_entries" ADD CONSTRAINT "ww_meter_register_entries_current_device_fk" FOREIGN KEY ("current_wattwatchers_device_id") REFERENCES "public"."ww_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ww_meter_register_entries_source_unique" ON "ww_meter_register_entries" USING btree ("source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ww_meter_register_entries_import_row_unique" ON "ww_meter_register_entries" USING btree ("import_id","source_row");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_existing_identifier_idx" ON "ww_meter_register_entries" USING btree ("existing_device_identifier");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_new_identifier_idx" ON "ww_meter_register_entries" USING btree ("new_device_identifier");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_current_identifier_idx" ON "ww_meter_register_entries" USING btree ("current_device_identifier");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_existing_device_idx" ON "ww_meter_register_entries" USING btree ("existing_wattwatchers_device_id");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_new_device_idx" ON "ww_meter_register_entries" USING btree ("new_wattwatchers_device_id");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_current_device_idx" ON "ww_meter_register_entries" USING btree ("current_wattwatchers_device_id");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_job_completion_idx" ON "ww_meter_register_entries" USING btree ("job_completion_date");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_maas_start_idx" ON "ww_meter_register_entries" USING btree ("maas_start_date");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_recurring_start_idx" ON "ww_meter_register_entries" USING btree ("recurring_start_date");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_invoice_issue_idx" ON "ww_meter_register_entries" USING btree ("invoice_issued_date");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_recurring_next_idx" ON "ww_meter_register_entries" USING btree ("recurring_next_invoice_issue_date");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_issued_period_next_idx" ON "ww_meter_register_entries" USING btree ("issued_period_next_invoice_issue_date");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_customer_idx" ON "ww_meter_register_entries" USING btree ("customer_name_snapshot");--> statement-breakpoint
CREATE INDEX "ww_meter_register_entries_client_idx" ON "ww_meter_register_entries" USING btree ("client_name_snapshot");--> statement-breakpoint
CREATE UNIQUE INDEX "ww_meter_register_imports_workbook_sheet_unique" ON "ww_meter_register_imports" USING btree ("workbook_sha256","source_sheet");
