CREATE TABLE "ea_water_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"zone_id" text NOT NULL,
	"audit_id" text NOT NULL,
	"asset_type" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"general_comments" text,
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photos" text[] DEFAULT '{}' NOT NULL,
	"photo_descs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ea_water_assets_type_check" CHECK ("asset_type" IN ('water_meter', 'water_submeter_logger', 'water_fixture', 'water_asset_system')),
	CONSTRAINT "ea_water_assets_data_object_check" CHECK (jsonb_typeof("data") = 'object'),
	CONSTRAINT "ea_water_assets_custom_fields_array_check" CHECK (jsonb_typeof("custom_fields") = 'array'),
	CONSTRAINT "ea_water_assets_photo_descs_object_check" CHECK (jsonb_typeof("photo_descs") = 'object')
);
--> statement-breakpoint
CREATE INDEX "ea_water_assets_audit_idx" ON "ea_water_assets" USING btree ("audit_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ea_water_assets_zone_idx" ON "ea_water_assets" USING btree ("zone_id", "created_at");
