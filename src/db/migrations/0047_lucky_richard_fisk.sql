CREATE TABLE "ih_inventory_meter_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"inventory_meter_id" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_custodian_user_id" text,
	"to_custodian_user_id" text,
	"installation_id" text,
	"meter_id" text,
	"actor_user_id" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_inventory_meter_movements_action_check" CHECK ("ih_inventory_meter_movements"."action" IN ('registered', 'claimed', 'assigned', 'returned', 'installed', 'edited', 'deleted')),
	CONSTRAINT "ih_inventory_meter_movements_status_check" CHECK (
    ("ih_inventory_meter_movements"."from_status" IS NULL OR "ih_inventory_meter_movements"."from_status" IN ('company', 'user', 'installed'))
    AND "ih_inventory_meter_movements"."to_status" IN ('company', 'user', 'installed')
  )
);
--> statement-breakpoint
CREATE TABLE "ih_inventory_meters" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"device_model" text NOT NULL,
	"custom_manufacturer_name" text,
	"custom_model_name" text,
	"status" text DEFAULT 'company' NOT NULL,
	"custodian_user_id" text,
	"installed_installation_id" text,
	"installed_meter_id" text,
	"business_client_id" text,
	"business_site_id" text,
	"business_job_id" text,
	"notes" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "ih_inventory_meters_model_check" CHECK ("ih_inventory_meters"."device_model" IN ('A3RM', 'A6M', 'OTHER')),
	CONSTRAINT "ih_inventory_meters_status_check" CHECK ("ih_inventory_meters"."status" IN ('company', 'user', 'installed')),
	CONSTRAINT "ih_inventory_meters_revision_check" CHECK ("ih_inventory_meters"."revision" >= 1),
	CONSTRAINT "ih_inventory_meters_device_id_check" CHECK (char_length(btrim("ih_inventory_meters"."device_id")) BETWEEN 1 AND 200),
	CONSTRAINT "ih_inventory_meters_notes_check" CHECK ("ih_inventory_meters"."notes" IS NULL OR char_length("ih_inventory_meters"."notes") <= 2000),
	CONSTRAINT "ih_inventory_meters_custody_check" CHECK (
    ("ih_inventory_meters"."status" = 'company' AND "ih_inventory_meters"."custodian_user_id" IS NULL AND "ih_inventory_meters"."installed_installation_id" IS NULL AND "ih_inventory_meters"."installed_meter_id" IS NULL)
    OR ("ih_inventory_meters"."status" = 'user' AND "ih_inventory_meters"."custodian_user_id" IS NOT NULL AND "ih_inventory_meters"."installed_installation_id" IS NULL AND "ih_inventory_meters"."installed_meter_id" IS NULL)
    OR ("ih_inventory_meters"."status" = 'installed' AND "ih_inventory_meters"."custodian_user_id" IS NULL AND "ih_inventory_meters"."installed_installation_id" IS NOT NULL AND "ih_inventory_meters"."installed_meter_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "ww_client_credentials" (
	"client_id" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ww_client_credentials_key_version_check" CHECK ("ww_client_credentials"."key_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "global_users" ADD COLUMN "is_maintainer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ww_clients" ADD COLUMN "source_business_client_id" text;--> statement-breakpoint
ALTER TABLE "ih_inventory_meter_movements" ADD CONSTRAINT "ih_inventory_meter_movements_inventory_meter_id_ih_inventory_meters_id_fk" FOREIGN KEY ("inventory_meter_id") REFERENCES "public"."ih_inventory_meters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ih_inventory_meters" ADD CONSTRAINT "ih_inventory_meters_custodian_user_id_ih_users_id_fk" FOREIGN KEY ("custodian_user_id") REFERENCES "public"."ih_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ih_inventory_meters" ADD CONSTRAINT "ih_inventory_meters_installed_installation_id_ih_installations_id_fk" FOREIGN KEY ("installed_installation_id") REFERENCES "public"."ih_installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ih_inventory_meters" ADD CONSTRAINT "ih_inventory_meters_installed_meter_id_ih_meter_devices_id_fk" FOREIGN KEY ("installed_meter_id") REFERENCES "public"."ih_meter_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_client_credentials" ADD CONSTRAINT "ww_client_credentials_client_id_ww_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ww_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ih_inventory_meter_movements_meter_idx" ON "ih_inventory_meter_movements" USING btree ("inventory_meter_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ih_inventory_meters_device_id_unique" ON "ih_inventory_meters" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "ih_inventory_meters_custody_idx" ON "ih_inventory_meters" USING btree ("status","custodian_user_id");--> statement-breakpoint
CREATE INDEX "ih_inventory_meters_installation_idx" ON "ih_inventory_meters" USING btree ("installed_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ww_clients_business_client_unique" ON "ww_clients" USING btree ("source_business_client_id");