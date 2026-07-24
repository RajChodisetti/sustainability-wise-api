CREATE TABLE "ih_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"role" text DEFAULT 'inspector' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ih_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"client_name" text NOT NULL,
	"site_name" text NOT NULL,
	"site_address" text NOT NULL,
	"inspector_name" text NOT NULL,
	"audit_date" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ih_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"zone_name" text NOT NULL,
	"zone_description" text DEFAULT '' NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ih_electrical_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"zone_id" text NOT NULL,
	"asset_name" text NOT NULL,
	"display_code" text NOT NULL,
	"asset_type" text NOT NULL,
	"electrical_parent_id" text,
	"electrical_parent_tbc" boolean DEFAULT false NOT NULL,
	"location_description" text,
	"phase" text,
	"amperage_rating" text,
	"site_nmi" text,
	"photo" text,
	"extra_photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meter_present" boolean DEFAULT false NOT NULL,
	"meters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sub_circuits_description" text,
	"comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ih_site_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"zone_id" text NOT NULL,
	"asset_name" text NOT NULL,
	"asset_type" text NOT NULL,
	"electrical_board_id" text,
	"electrical_board_tbc" boolean DEFAULT false NOT NULL,
	"location_description" text,
	"location_photo" text,
	"display_code" text,
	"meter_present" boolean DEFAULT false NOT NULL,
	"meter_switchboard_id" text,
	"meter_switchboard_tbc" boolean DEFAULT false NOT NULL,
	"meter_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments" text,
	"extra_photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ih_form_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"form_type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"zone_id" text,
	"board_id" text,
	"meter_id" text,
	"site_asset_id" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp,
	"supersedes_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ih_installations_owner_idx" ON "ih_installations" USING btree ("created_by_user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "ih_zones_installation_idx" ON "ih_zones" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX "ih_electrical_assets_installation_idx" ON "ih_electrical_assets" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX "ih_electrical_assets_zone_idx" ON "ih_electrical_assets" USING btree ("zone_id");
--> statement-breakpoint
CREATE INDEX "ih_site_assets_installation_idx" ON "ih_site_assets" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX "ih_site_assets_zone_idx" ON "ih_site_assets" USING btree ("zone_id");
--> statement-breakpoint
CREATE INDEX "ih_form_submissions_installation_idx" ON "ih_form_submissions" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX "ih_form_submissions_type_idx" ON "ih_form_submissions" USING btree ("form_type","status");
