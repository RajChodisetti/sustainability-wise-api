CREATE TABLE "ww_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ww_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ww_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"is_maas" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"label" text,
	"model" text,
	"install_date" date,
	"firmware_version" text,
	"device_timezone" text,
	"primary_client_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_device_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"client_id" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_collection_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_run_key" text NOT NULL,
	"collector_version" text,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"reporting_date" date NOT NULL,
	"timezone" text DEFAULT 'Australia/Melbourne' NOT NULL,
	"delayed_threshold_minutes" integer DEFAULT 15 NOT NULL,
	"offline_threshold_minutes" integer DEFAULT 60 NOT NULL,
	"report_offline_threshold_hours" integer DEFAULT 24 NOT NULL,
	"inventory_scope" text DEFAULT 'partial' NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"configured_client_count" integer DEFAULT 0 NOT NULL,
	"successful_client_count" integer DEFAULT 0 NOT NULL,
	"failed_client_count" integer DEFAULT 0 NOT NULL,
	"raw_device_count" integer DEFAULT 0 NOT NULL,
	"total_devices" integer DEFAULT 0 NOT NULL,
	"communicating_count" integer DEFAULT 0 NOT NULL,
	"delayed_count" integer DEFAULT 0 NOT NULL,
	"offline_count" integer DEFAULT 0 NOT NULL,
	"inactive_count" integer DEFAULT 0 NOT NULL,
	"unknown_count" integer DEFAULT 0 NOT NULL,
	"report_offline_count" integer DEFAULT 0 NOT NULL,
	"report_newly_offline_count" integer DEFAULT 0 NOT NULL,
	"report_recovered_count" integer DEFAULT 0 NOT NULL,
	"report_still_offline_count" integer DEFAULT 0 NOT NULL,
	"maas_total_count" integer DEFAULT 0 NOT NULL,
	"maas_report_offline_count" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"rate_limit_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_client_run_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"client_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"requested_device_count" integer DEFAULT 0 NOT NULL,
	"fetched_device_count" integer DEFAULT 0 NOT NULL,
	"communicating_count" integer DEFAULT 0 NOT NULL,
	"delayed_count" integer DEFAULT 0 NOT NULL,
	"offline_count" integer DEFAULT 0 NOT NULL,
	"inactive_count" integer DEFAULT 0 NOT NULL,
	"unknown_count" integer DEFAULT 0 NOT NULL,
	"report_offline_count" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"rate_limit_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_device_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"device_id" text NOT NULL,
	"client_id" text,
	"observed_at" timestamp with time zone NOT NULL,
	"last_heard_at" timestamp with time zone,
	"latest_status_at" timestamp with time zone,
	"communication_age_seconds" integer,
	"status" text NOT NULL,
	"report_offline" boolean DEFAULT false NOT NULL,
	"report_transition" text,
	"fetch_status" text DEFAULT 'ok' NOT NULL,
	"fetch_error" text,
	"uninitialised" boolean DEFAULT false NOT NULL,
	"is_maas" boolean DEFAULT false NOT NULL,
	"label_snapshot" text,
	"model_snapshot" text,
	"install_date_snapshot" date,
	"firmware_version" text,
	"device_timezone" text,
	"comms_type" text,
	"comms_mode" text,
	"last_heard_via" text,
	"signal_quality_dbm" real,
	"cell_quality" real,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_observation_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"device_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_code_snapshot" text NOT NULL,
	"client_name_snapshot" text NOT NULL,
	"is_maas" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_outages" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"client_id" text,
	"opened_run_id" text NOT NULL,
	"closed_run_id" text,
	"telemetry_stopped_at" timestamp with time zone,
	"threshold_qualified_at" timestamp with time zone,
	"first_detected_at" timestamp with time zone NOT NULL,
	"last_confirmed_at" timestamp with time zone NOT NULL,
	"recovered_at" timestamp with time zone,
	"duration_seconds" integer,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"status" text DEFAULT 'generated' NOT NULL,
	"subject" text,
	"rendered_html" text,
	"csv_filename" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ww_report_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ww_devices" ADD CONSTRAINT "ww_devices_primary_client_id_ww_clients_id_fk" FOREIGN KEY ("primary_client_id") REFERENCES "public"."ww_clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_device_clients" ADD CONSTRAINT "ww_device_clients_device_id_ww_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."ww_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_device_clients" ADD CONSTRAINT "ww_device_clients_client_id_ww_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ww_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_client_run_results" ADD CONSTRAINT "ww_client_run_results_run_id_ww_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ww_collection_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_client_run_results" ADD CONSTRAINT "ww_client_run_results_client_id_ww_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ww_clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_device_observations" ADD CONSTRAINT "ww_device_observations_run_id_ww_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ww_collection_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_device_observations" ADD CONSTRAINT "ww_device_observations_device_id_ww_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."ww_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_device_observations" ADD CONSTRAINT "ww_device_observations_client_id_ww_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ww_clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_observation_clients" ADD CONSTRAINT "ww_observation_clients_observation_id_ww_device_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ww_device_observations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_observation_clients" ADD CONSTRAINT "ww_observation_clients_run_id_ww_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ww_collection_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_observation_clients" ADD CONSTRAINT "ww_observation_clients_device_id_ww_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."ww_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_observation_clients" ADD CONSTRAINT "ww_observation_clients_client_id_ww_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ww_clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_outages" ADD CONSTRAINT "ww_outages_device_id_ww_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."ww_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_outages" ADD CONSTRAINT "ww_outages_client_id_ww_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ww_clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_outages" ADD CONSTRAINT "ww_outages_opened_run_id_ww_collection_runs_id_fk" FOREIGN KEY ("opened_run_id") REFERENCES "public"."ww_collection_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_outages" ADD CONSTRAINT "ww_outages_closed_run_id_ww_collection_runs_id_fk" FOREIGN KEY ("closed_run_id") REFERENCES "public"."ww_collection_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_reports" ADD CONSTRAINT "ww_reports_run_id_ww_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ww_collection_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ww_report_deliveries" ADD CONSTRAINT "ww_report_deliveries_report_id_ww_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."ww_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_clients_code_unique" ON "ww_clients" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "ww_clients_name_idx" ON "ww_clients" USING btree ("normalized_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_devices_device_id_unique" ON "ww_devices" USING btree ("device_id");
--> statement-breakpoint
CREATE INDEX "ww_devices_primary_client_idx" ON "ww_devices" USING btree ("primary_client_id");
--> statement-breakpoint
CREATE INDEX "ww_devices_label_idx" ON "ww_devices" USING btree ("label");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_device_clients_unique" ON "ww_device_clients" USING btree ("device_id","client_id");
--> statement-breakpoint
CREATE INDEX "ww_device_clients_client_idx" ON "ww_device_clients" USING btree ("client_id","is_current");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_collection_runs_source_key_unique" ON "ww_collection_runs" USING btree ("source_run_key");
--> statement-breakpoint
CREATE INDEX "ww_collection_runs_published_idx" ON "ww_collection_runs" USING btree ("status","published_at");
--> statement-breakpoint
CREATE INDEX "ww_collection_runs_reporting_date_idx" ON "ww_collection_runs" USING btree ("reporting_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_client_run_results_unique" ON "ww_client_run_results" USING btree ("run_id","client_id");
--> statement-breakpoint
CREATE INDEX "ww_client_run_results_run_status_idx" ON "ww_client_run_results" USING btree ("run_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_device_observations_unique" ON "ww_device_observations" USING btree ("run_id","device_id");
--> statement-breakpoint
CREATE INDEX "ww_device_observations_run_status_idx" ON "ww_device_observations" USING btree ("run_id","status");
--> statement-breakpoint
CREATE INDEX "ww_device_observations_run_report_idx" ON "ww_device_observations" USING btree ("run_id","report_offline");
--> statement-breakpoint
CREATE INDEX "ww_device_observations_device_time_idx" ON "ww_device_observations" USING btree ("device_id","observed_at");
--> statement-breakpoint
CREATE INDEX "ww_device_observations_client_status_idx" ON "ww_device_observations" USING btree ("client_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_observation_clients_unique" ON "ww_observation_clients" USING btree ("observation_id","client_id");
--> statement-breakpoint
CREATE INDEX "ww_observation_clients_run_client_idx" ON "ww_observation_clients" USING btree ("run_id","client_id","device_id");
--> statement-breakpoint
CREATE INDEX "ww_observation_clients_device_idx" ON "ww_observation_clients" USING btree ("device_id","run_id");
--> statement-breakpoint
CREATE INDEX "ww_outages_device_idx" ON "ww_outages" USING btree ("device_id","first_detected_at");
--> statement-breakpoint
CREATE INDEX "ww_outages_open_idx" ON "ww_outages" USING btree ("closed_run_id","last_confirmed_at");
--> statement-breakpoint
CREATE INDEX "ww_outages_client_idx" ON "ww_outages" USING btree ("client_id","first_detected_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_reports_run_unique" ON "ww_reports" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "ww_reports_generated_idx" ON "ww_reports" USING btree ("generated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ww_report_deliveries_idempotency_unique" ON "ww_report_deliveries" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "ww_report_deliveries_report_idx" ON "ww_report_deliveries" USING btree ("report_id","attempted_at");
