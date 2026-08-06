ALTER TABLE "ih_display_code_claims" ADD COLUMN "zone_id" text;--> statement-breakpoint
ALTER TABLE "ih_meter_devices" ADD COLUMN "custom_name" text;--> statement-breakpoint
UPDATE "ih_meter_devices"
SET "custom_name" = CASE
  WHEN "display_code_overridden" = true
    AND NULLIF(btrim("display_code"), '') IS NOT NULL
    THEN btrim("display_code")
  WHEN "device_model" = 'A3RM' THEN 'A3RM Meter'
  WHEN "device_model" = 'A6M' THEN 'A6M Meter'
  ELSE COALESCE(
    NULLIF(btrim("custom_model_name"), ''),
    NULLIF(btrim("custom_manufacturer_name"), ''),
    'Meter'
  )
END;--> statement-breakpoint
ALTER TABLE "ih_meter_devices" ALTER COLUMN "custom_name" SET DEFAULT 'Meter';--> statement-breakpoint
ALTER TABLE "ih_meter_devices" ALTER COLUMN "custom_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ih_zones" ADD COLUMN "zone_code" text;--> statement-breakpoint
WITH "ranked_zones" AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(
        trim(BOTH '-' FROM regexp_replace(upper("zone_name"), '[^A-Z0-9]+', '-', 'g')),
        ''
      ),
      'ZONE'
    ) AS "base_code",
    lpad(
      row_number() OVER (
        PARTITION BY "installation_id"
        ORDER BY "created_at", "id"
      )::text,
      2,
      '0'
    ) AS "ordinal"
  FROM "ih_zones"
)
UPDATE "ih_zones" AS "zone"
SET "zone_code" = substring(
  "ranked_zones"."base_code"
  FROM 1
  FOR greatest(1, 15 - length("ranked_zones"."ordinal"))
) || '-' || "ranked_zones"."ordinal"
FROM "ranked_zones"
WHERE "zone"."id" = "ranked_zones"."id";--> statement-breakpoint
ALTER TABLE "ih_zones" ALTER COLUMN "zone_code" SET DEFAULT 'ZONE';--> statement-breakpoint
ALTER TABLE "ih_zones" ALTER COLUMN "zone_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ih_display_code_claims" ADD CONSTRAINT "ih_display_code_claims_zone_fk" FOREIGN KEY ("installation_id","zone_id") REFERENCES "public"."ih_zones"("installation_id","id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE UNIQUE INDEX "ih_display_code_claims_zone_sequence_unique" ON "ih_display_code_claims" USING btree ("installation_id","zone_id","sequence") WHERE "ih_display_code_claims"."rule_version" = 2 AND "ih_display_code_claims"."zone_id" IS NOT NULL AND "ih_display_code_claims"."sequence" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ih_zones_active_code_unique" ON "ih_zones" USING btree ("installation_id","zone_code") WHERE "ih_zones"."deleted_at" IS NULL;
