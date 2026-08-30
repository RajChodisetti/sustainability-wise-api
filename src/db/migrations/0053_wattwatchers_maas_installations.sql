CREATE TABLE "ww_device_installation_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	"fleet_account_client_id" text NOT NULL,
	"business_client_id" text NOT NULL,
	"business_site_id" text,
	"customer_name_snapshot" text NOT NULL,
	"site_name_snapshot" text,
	"site_address_snapshot" text,
	"device_label_snapshot" text NOT NULL,
	"job_completion_date" date,
	"maas_start_date" date,
	"effective_date" date NOT NULL,
	"existing_device_id" text,
	"new_device_id" text,
	"current_device_id" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ww_device_installation_assignments_source_row_check" CHECK ("ww_device_installation_assignments"."source_row" >= 2),
	CONSTRAINT "ww_device_installation_assignments_date_check" CHECK (
    num_nonnulls("ww_device_installation_assignments"."job_completion_date", "ww_device_installation_assignments"."maas_start_date") = 1
    AND "ww_device_installation_assignments"."effective_date" = coalesce("ww_device_installation_assignments"."job_completion_date", "ww_device_installation_assignments"."maas_start_date")
  ),
	CONSTRAINT "ww_device_installation_assignments_device_check" CHECK (
    num_nonnulls("ww_device_installation_assignments"."existing_device_id", "ww_device_installation_assignments"."new_device_id") >= 1
    AND "ww_device_installation_assignments"."current_device_id" = coalesce("ww_device_installation_assignments"."new_device_id", "ww_device_installation_assignments"."existing_device_id")
    AND ("ww_device_installation_assignments"."new_device_id" IS NULL OR "ww_device_installation_assignments"."existing_device_id" IS NULL OR "ww_device_installation_assignments"."new_device_id" <> "ww_device_installation_assignments"."existing_device_id")
  ),
	CONSTRAINT "ww_device_installation_assignments_unknown_site_check" CHECK (
    ("ww_device_installation_assignments"."business_site_id" IS NULL AND "ww_device_installation_assignments"."site_address_snapshot" IS NULL)
    OR ("ww_device_installation_assignments"."business_site_id" IS NOT NULL AND "ww_device_installation_assignments"."site_address_snapshot" IS NOT NULL)
  ),
	CONSTRAINT "ww_device_installation_assignments_notes_check" CHECK (
    "ww_device_installation_assignments"."notes" IS NULL OR char_length("ww_device_installation_assignments"."notes") <= 2_000
  )
);
--> statement-breakpoint
ALTER TABLE "ww_device_installation_assignments" ADD CONSTRAINT "ww_device_installation_assignments_fleet_account_client_id_ww_clients_id_fk" FOREIGN KEY ("fleet_account_client_id") REFERENCES "public"."ww_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_device_installation_assignments" ADD CONSTRAINT "ww_device_installation_assignments_business_client_id_business_clients_id_fk" FOREIGN KEY ("business_client_id") REFERENCES "public"."business_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_device_installation_assignments" ADD CONSTRAINT "ww_device_installation_assignments_business_site_id_business_sites_id_fk" FOREIGN KEY ("business_site_id") REFERENCES "public"."business_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_device_installation_assignments" ADD CONSTRAINT "ww_device_installation_assignments_existing_device_id_ww_devices_id_fk" FOREIGN KEY ("existing_device_id") REFERENCES "public"."ww_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_device_installation_assignments" ADD CONSTRAINT "ww_device_installation_assignments_new_device_id_ww_devices_id_fk" FOREIGN KEY ("new_device_id") REFERENCES "public"."ww_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_device_installation_assignments" ADD CONSTRAINT "ww_device_installation_assignments_current_device_id_ww_devices_id_fk" FOREIGN KEY ("current_device_id") REFERENCES "public"."ww_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ww_device_installation_assignments_source_unique" ON "ww_device_installation_assignments" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "ww_device_installation_assignments_account_idx" ON "ww_device_installation_assignments" USING btree ("fleet_account_client_id");--> statement-breakpoint
CREATE INDEX "ww_device_installation_assignments_business_client_idx" ON "ww_device_installation_assignments" USING btree ("business_client_id");--> statement-breakpoint
CREATE INDEX "ww_device_installation_assignments_site_idx" ON "ww_device_installation_assignments" USING btree ("business_site_id");--> statement-breakpoint
CREATE INDEX "ww_device_installation_assignments_current_device_idx" ON "ww_device_installation_assignments" USING btree ("current_device_id");