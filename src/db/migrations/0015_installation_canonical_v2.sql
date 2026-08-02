-- Expand-only persistence for the InstallHub canonical installation tree.
-- Existing 0012-0014 tables remain in place so the legacy API can run while
-- canonical-v2 clients are deployed and the explicit backfill is audited.

ALTER TABLE "ih_installations" ADD COLUMN "external_key" text;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_code" text;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "timezone" text DEFAULT 'Australia/Sydney' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "tree_schema_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "tree_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "record_version_number" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "completed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "completed_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "completed_from_revision" integer;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "reopened_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "reopened_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "reopened_from_version_number" integer;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "reopen_reason" text;
--> statement-breakpoint

-- Stable, deterministic values for rows that predate canonical-v2. New legacy
-- writers receive a database-generated key until the API deployment is live.
UPDATE "ih_installations"
SET "external_key" = 'ih_legacy_' || md5("id")
WHERE "external_key" IS NULL;
--> statement-breakpoint
UPDATE "ih_installations"
SET "site_code" = COALESCE(
	NULLIF(
		trim(BOTH '-' FROM regexp_replace(upper("site_name"), '[^A-Z0-9]+', '-', 'g')),
		''
	),
	'SITE'
)
WHERE "site_code" IS NULL;
--> statement-breakpoint
UPDATE "ih_installations" AS installation
SET "record_version_number" = COALESCE((
	SELECT max(version."version_number")
	FROM "record_versions" AS version
	WHERE version."app" = 'installhub'
		AND version."entity_type" = 'installation'
		AND version."entity_id" = installation."id"
), 0);
--> statement-breakpoint
ALTER TABLE "ih_installations" ALTER COLUMN "external_key" SET DEFAULT ('ih_' || gen_random_uuid()::text);
--> statement-breakpoint
ALTER TABLE "ih_installations" ALTER COLUMN "external_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_installations" ALTER COLUMN "site_code" SET DEFAULT 'SITE';
--> statement-breakpoint
ALTER TABLE "ih_installations" ALTER COLUMN "site_code" SET NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ih_reject_external_key_update"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF OLD."external_key" IS DISTINCT FROM NEW."external_key" THEN
		RAISE EXCEPTION 'InstallHub installation external_key is immutable'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "ih_installations_external_key_immutable"
	BEFORE UPDATE OF "external_key" ON "ih_installations"
	FOR EACH ROW
	EXECUTE FUNCTION "ih_reject_external_key_update"();
--> statement-breakpoint

ALTER TABLE "record_versions" ADD COLUMN "schema_version" integer;
--> statement-breakpoint
ALTER TABLE "record_versions" ADD COLUMN "canonicalizer_version" text;
--> statement-breakpoint
ALTER TABLE "record_versions" ADD COLUMN "validator_version" text;
--> statement-breakpoint
ALTER TABLE "record_versions" ADD COLUMN "taxonomy_version" text;
--> statement-breakpoint
ALTER TABLE "record_versions" ADD COLUMN "payload_hash" text;
--> statement-breakpoint

ALTER TABLE "ih_electrical_assets" ADD COLUMN "generated_display_code" text;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "display_code_overridden" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "display_code_rule_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "display_code_override_reason" text;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "type_code" text DEFAULT 'OTHER' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "custom_type_name" text;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "source_kind" text DEFAULT 'LEGACY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "grid_supply_id" text;
--> statement-breakpoint

ALTER TABLE "ih_site_assets" ADD COLUMN "type_code" text DEFAULT 'OTHER' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "custom_type_name" text;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "source_kind" text DEFAULT 'LEGACY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "grid_supply_id" text;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "generated_display_code" text;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "display_code_overridden" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "display_code_rule_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "display_code_override_reason" text;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "metering_state_kind" text DEFAULT 'TBC' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "measurement_assignment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

ALTER TABLE "ih_form_submissions" ADD COLUMN "historical_meter_removed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

CREATE TABLE "ih_grid_supplies" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"nmi" text,
	"external_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ih_meter_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"installed_on_board_id" text NOT NULL,
	"device_family" text NOT NULL,
	"device_model" text NOT NULL,
	"custom_manufacturer_name" text,
	"custom_model_name" text,
	"device_number" text,
	"serial_number" text NOT NULL,
	"display_code" text,
	"generated_display_code" text,
	"display_code_overridden" boolean DEFAULT false NOT NULL,
	"display_code_rule_version" integer DEFAULT 1 NOT NULL,
	"display_code_override_reason" text,
	"ww_photos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_meter_devices_family_check" CHECK ("device_family" IN ('WATTWATCHERS', 'OTHER')),
	CONSTRAINT "ih_meter_devices_model_check" CHECK ("device_model" IN ('A3RM', 'A6M', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "ih_meter_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"phase_label" text,
	"purpose" text NOT NULL,
	"load_type_code" text,
	"custom_load_type_name" text,
	"sensor_rating" text,
	"description" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_meter_channels_ordinal_check" CHECK ("ordinal" > 0),
	CONSTRAINT "ih_meter_channels_purpose_check" CHECK ("purpose" IN ('MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE'))
);
--> statement-breakpoint
CREATE TABLE "ih_measurement_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"installation_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"phase_mode" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_board_id" text,
	"target_site_asset_id" text,
	"target_grid_supply_id" text,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_measurement_assignments_phase_check" CHECK ("phase_mode" IN ('SINGLE_PHASE', 'THREE_PHASE', 'OTHER')),
	CONSTRAINT "ih_measurement_assignments_direction_check" CHECK ("direction" IN ('CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL')),
	CONSTRAINT "ih_measurement_assignments_target_check" CHECK (
		("target_kind" = 'BOARD' AND "target_board_id" IS NOT NULL AND "target_site_asset_id" IS NULL AND "target_grid_supply_id" IS NULL AND "status" = 'CONFIRMED')
		OR ("target_kind" = 'SITE_ASSET' AND "target_board_id" IS NULL AND "target_site_asset_id" IS NOT NULL AND "target_grid_supply_id" IS NULL AND "status" = 'CONFIRMED')
		OR ("target_kind" = 'GRID_BOUNDARY' AND "target_board_id" IS NULL AND "target_site_asset_id" IS NULL AND "target_grid_supply_id" IS NOT NULL AND "status" = 'CONFIRMED')
		OR ("target_kind" = 'TBC' AND "target_board_id" IS NULL AND "target_site_asset_id" IS NULL AND "target_grid_supply_id" IS NULL AND "status" = 'TBC')
	)
);
--> statement-breakpoint
CREATE TABLE "ih_measurement_assignment_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ih_display_code_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"type_code" text NOT NULL,
	"sequence" integer,
	"display_code" text NOT NULL,
	"normalized_display_code" text NOT NULL,
	"generated" boolean DEFAULT false NOT NULL,
	"rule_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ih_completion_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"operation" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"completed_from_revision" integer NOT NULL,
	"resulting_tree_revision" integer NOT NULL,
	"record_version_number" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "ih_installations_external_key_unique" ON "ih_installations" ("external_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_zones_installation_id_unique" ON "ih_zones" ("installation_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_electrical_assets_installation_id_unique" ON "ih_electrical_assets" ("installation_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_site_assets_installation_id_unique" ON "ih_site_assets" ("installation_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_form_submissions_installation_id_unique" ON "ih_form_submissions" ("installation_id", "id");
--> statement-breakpoint

CREATE INDEX "ih_grid_supplies_installation_idx" ON "ih_grid_supplies" ("installation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_grid_supplies_installation_id_unique" ON "ih_grid_supplies" ("installation_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_grid_supplies_installation_external_key_unique" ON "ih_grid_supplies" ("installation_id", "external_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_grid_supplies_one_active_default_unique" ON "ih_grid_supplies" ("installation_id") WHERE "is_default" = true AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "ih_meter_devices_installation_idx" ON "ih_meter_devices" ("installation_id");
--> statement-breakpoint
CREATE INDEX "ih_meter_devices_board_idx" ON "ih_meter_devices" ("installed_on_board_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_meter_devices_installation_id_unique" ON "ih_meter_devices" ("installation_id", "id");
--> statement-breakpoint
CREATE INDEX "ih_meter_channels_installation_idx" ON "ih_meter_channels" ("installation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_meter_channels_installation_id_unique" ON "ih_meter_channels" ("installation_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_meter_channels_installation_meter_id_unique" ON "ih_meter_channels" ("installation_id", "meter_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_meter_channels_meter_ordinal_unique" ON "ih_meter_channels" ("meter_id", "ordinal");
--> statement-breakpoint
CREATE INDEX "ih_measurement_assignments_installation_idx" ON "ih_measurement_assignments" ("installation_id");
--> statement-breakpoint
CREATE INDEX "ih_measurement_assignments_meter_idx" ON "ih_measurement_assignments" ("meter_id");
--> statement-breakpoint
CREATE INDEX "ih_measurement_assignments_board_idx" ON "ih_measurement_assignments" ("target_board_id");
--> statement-breakpoint
CREATE INDEX "ih_measurement_assignments_asset_idx" ON "ih_measurement_assignments" ("target_site_asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_measurement_assignments_installation_id_unique" ON "ih_measurement_assignments" ("installation_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_measurement_assignments_installation_meter_id_unique" ON "ih_measurement_assignments" ("installation_id", "meter_id", "id");
--> statement-breakpoint
CREATE INDEX "ih_assignment_channels_installation_idx" ON "ih_measurement_assignment_channels" ("installation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_assignment_channels_assignment_position_unique" ON "ih_measurement_assignment_channels" ("assignment_id", "position");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_assignment_channels_assignment_channel_unique" ON "ih_measurement_assignment_channels" ("assignment_id", "channel_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_assignment_channels_active_channel_unique" ON "ih_measurement_assignment_channels" ("channel_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_display_code_claims_installation_code_unique" ON "ih_display_code_claims" ("installation_id", "normalized_display_code");
--> statement-breakpoint
CREATE INDEX "ih_display_code_claims_sequence_idx" ON "ih_display_code_claims" ("installation_id", "type_code", "sequence");
--> statement-breakpoint
CREATE INDEX "ih_display_code_claims_entity_idx" ON "ih_display_code_claims" ("installation_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ih_completion_idempotency_scope_unique" ON "ih_completion_idempotency" ("installation_id", "operation", "actor_user_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "ih_completion_idempotency_installation_idx" ON "ih_completion_idempotency" ("installation_id");
--> statement-breakpoint

ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_tree_schema_version_check" CHECK ("tree_schema_version" IN (1, 2)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_tree_revision_check" CHECK ("tree_revision" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_record_version_check" CHECK ("record_version_number" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_status_check" CHECK ("status" IN ('Draft', 'Completed')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_external_key_nonempty_check" CHECK (length(btrim("external_key")) > 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD CONSTRAINT "ih_electrical_assets_source_check" CHECK (
	("source_kind" = 'GRID' AND "grid_supply_id" IS NOT NULL AND "electrical_parent_id" IS NULL AND "electrical_parent_tbc" = false)
	OR ("source_kind" = 'BOARD' AND "grid_supply_id" IS NULL AND "electrical_parent_id" IS NOT NULL AND "electrical_parent_tbc" = false)
	OR ("source_kind" = 'TBC' AND "grid_supply_id" IS NULL AND "electrical_parent_id" IS NULL AND "electrical_parent_tbc" = true)
	OR ("source_kind" = 'LEGACY' AND "grid_supply_id" IS NULL)
) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD CONSTRAINT "ih_site_assets_source_check" CHECK (
	("source_kind" = 'GRID' AND "grid_supply_id" IS NOT NULL AND "electrical_board_id" IS NULL AND "electrical_board_tbc" = false)
	OR ("source_kind" = 'BOARD' AND "grid_supply_id" IS NULL AND "electrical_board_id" IS NOT NULL AND "electrical_board_tbc" = false)
	OR ("source_kind" = 'TBC' AND "grid_supply_id" IS NULL AND "electrical_board_id" IS NULL AND "electrical_board_tbc" = true)
	OR ("source_kind" = 'LEGACY' AND "grid_supply_id" IS NULL)
) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD CONSTRAINT "ih_site_assets_metering_state_check" CHECK ("metering_state_kind" IN ('METERED', 'UNMETERED', 'TBC')) NOT VALID;
--> statement-breakpoint

-- Scoped ownership fences are NOT VALID deliberately: they protect every new
-- write immediately while allowing legacy inconsistencies to be reported by
-- the dry-run backfill instead of blocking the expand migration.
ALTER TABLE "ih_zones" ADD CONSTRAINT "ih_zones_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD CONSTRAINT "ih_electrical_assets_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD CONSTRAINT "ih_electrical_assets_zone_fk" FOREIGN KEY ("installation_id", "zone_id") REFERENCES "ih_zones" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD CONSTRAINT "ih_electrical_assets_parent_fk" FOREIGN KEY ("installation_id", "electrical_parent_id") REFERENCES "ih_electrical_assets" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD CONSTRAINT "ih_site_assets_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD CONSTRAINT "ih_site_assets_zone_fk" FOREIGN KEY ("installation_id", "zone_id") REFERENCES "ih_zones" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD CONSTRAINT "ih_site_assets_source_board_fk" FOREIGN KEY ("installation_id", "electrical_board_id") REFERENCES "ih_electrical_assets" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD CONSTRAINT "ih_site_assets_meter_board_fk" FOREIGN KEY ("installation_id", "meter_switchboard_id") REFERENCES "ih_electrical_assets" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_zone_fk" FOREIGN KEY ("installation_id", "zone_id") REFERENCES "ih_zones" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_board_fk" FOREIGN KEY ("installation_id", "board_id") REFERENCES "ih_electrical_assets" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_meter_fk" FOREIGN KEY ("installation_id", "meter_id") REFERENCES "ih_meter_devices" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_site_asset_fk" FOREIGN KEY ("installation_id", "site_asset_id") REFERENCES "ih_site_assets" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_supersedes_fk" FOREIGN KEY ("installation_id", "supersedes_id") REFERENCES "ih_form_submissions" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_status_check" CHECK ("status" IN ('Draft', 'Completed')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_form_submissions" ADD CONSTRAINT "ih_form_submissions_schema_version_check" CHECK ("schema_version" IN (1, 2)) NOT VALID;
--> statement-breakpoint

ALTER TABLE "ih_grid_supplies" ADD CONSTRAINT "ih_grid_supplies_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD CONSTRAINT "ih_electrical_assets_grid_supply_fk" FOREIGN KEY ("installation_id", "grid_supply_id") REFERENCES "ih_grid_supplies" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD CONSTRAINT "ih_site_assets_grid_supply_fk" FOREIGN KEY ("installation_id", "grid_supply_id") REFERENCES "ih_grid_supplies" ("installation_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "ih_meter_devices" ADD CONSTRAINT "ih_meter_devices_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_meter_devices" ADD CONSTRAINT "ih_meter_devices_board_fk" FOREIGN KEY ("installation_id", "installed_on_board_id") REFERENCES "ih_electrical_assets" ("installation_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_meter_channels" ADD CONSTRAINT "ih_meter_channels_meter_fk" FOREIGN KEY ("installation_id", "meter_id") REFERENCES "ih_meter_devices" ("installation_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_measurement_assignments" ADD CONSTRAINT "ih_measurement_assignments_meter_fk" FOREIGN KEY ("installation_id", "meter_id") REFERENCES "ih_meter_devices" ("installation_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_measurement_assignments" ADD CONSTRAINT "ih_measurement_assignments_board_fk" FOREIGN KEY ("installation_id", "target_board_id") REFERENCES "ih_electrical_assets" ("installation_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_measurement_assignments" ADD CONSTRAINT "ih_measurement_assignments_asset_fk" FOREIGN KEY ("installation_id", "target_site_asset_id") REFERENCES "ih_site_assets" ("installation_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_measurement_assignments" ADD CONSTRAINT "ih_measurement_assignments_grid_fk" FOREIGN KEY ("installation_id", "target_grid_supply_id") REFERENCES "ih_grid_supplies" ("installation_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_measurement_assignment_channels" ADD CONSTRAINT "ih_assignment_channels_assignment_fk" FOREIGN KEY ("installation_id", "meter_id", "assignment_id") REFERENCES "ih_measurement_assignments" ("installation_id", "meter_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_measurement_assignment_channels" ADD CONSTRAINT "ih_assignment_channels_channel_fk" FOREIGN KEY ("installation_id", "meter_id", "channel_id") REFERENCES "ih_meter_channels" ("installation_id", "meter_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_display_code_claims" ADD CONSTRAINT "ih_display_code_claims_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ih_completion_idempotency" ADD CONSTRAINT "ih_completion_idempotency_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "ih_installations" ("id") ON DELETE restrict;
