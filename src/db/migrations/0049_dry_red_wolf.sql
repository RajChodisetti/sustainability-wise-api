CREATE TABLE "business_client_merge_events" (
	"id" text PRIMARY KEY NOT NULL,
	"company_key" text NOT NULL,
	"source_client_id" text NOT NULL,
	"target_client_id" text NOT NULL,
	"merged_by_user_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_client_merge_events_company_key_check" CHECK (
    char_length(btrim("business_client_merge_events"."company_key")) BETWEEN 1 AND 100
  ),
	CONSTRAINT "business_client_merge_events_distinct_clients_check" CHECK (
    "business_client_merge_events"."source_client_id" <> "business_client_merge_events"."target_client_id"
  ),
	CONSTRAINT "business_client_merge_events_reason_check" CHECK (
    char_length(btrim("business_client_merge_events"."reason")) BETWEEN 1 AND 1000
  )
);
--> statement-breakpoint
ALTER TABLE "business_sites" DROP CONSTRAINT "business_sites_country_check";--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "business_site_id" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "site_address_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "business_site_id" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "site_address_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_clients" ADD COLUMN "company_key" text;--> statement-breakpoint
ALTER TABLE "business_clients" ADD COLUMN "normalized_key" text;--> statement-breakpoint
ALTER TABLE "business_clients" ADD COLUMN "merged_into_client_id" text;--> statement-breakpoint
ALTER TABLE "business_clients" ADD COLUMN "merged_at" timestamp;--> statement-breakpoint
ALTER TABLE "business_clients" ADD COLUMN "merged_by_user_id" text;--> statement-breakpoint
ALTER TABLE "business_sites" ADD COLUMN "address_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sites" ADD COLUMN "geocode_status" text DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sites" ADD COLUMN "geocode_provider" text;--> statement-breakpoint
ALTER TABLE "business_sites" ADD COLUMN "geocode_place_id" text;--> statement-breakpoint
ALTER TABLE "business_sites" ADD COLUMN "address_fingerprint" text;--> statement-breakpoint
ALTER TABLE "business_sites" ADD COLUMN "geocoded_at" timestamp;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "business_site_id" text;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD COLUMN "site_address_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint

-- Expand/migrate: do not merge normalized duplicates here. Migration 0045 used
-- site names as provisional EcoAudit/SolarSense clients, so an administrator
-- must review duplicates before using the audited merge operation.
UPDATE "business_clients"
SET
	"company_key" = 'sustainability-wise',
	"normalized_key" = lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'));--> statement-breakpoint
CREATE FUNCTION "sw_business_client_memory_defaults"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	-- The static migration and runtime deliberately support one company scope.
	NEW.company_key := 'sustainability-wise';
	IF NEW.normalized_key IS NULL OR btrim(NEW.normalized_key) = '' THEN
		NEW.normalized_key := lower(regexp_replace(btrim(NEW.name), '[[:space:]]+', ' ', 'g'));
	ELSIF TG_OP = 'UPDATE'
		AND NEW.name IS DISTINCT FROM OLD.name
		AND NEW.normalized_key IS NOT DISTINCT FROM OLD.normalized_key THEN
		-- Keep writes from a pre-0049 process valid after the NOT NULL expansion.
		NEW.normalized_key := lower(regexp_replace(btrim(NEW.name), '[[:space:]]+', ' ', 'g'));
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "business_clients_memory_defaults_trigger"
BEFORE INSERT OR UPDATE OF "name", "company_key", "normalized_key"
ON "business_clients"
FOR EACH ROW EXECUTE FUNCTION "sw_business_client_memory_defaults"();--> statement-breakpoint
ALTER TABLE "business_clients" ALTER COLUMN "company_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "business_clients" ALTER COLUMN "normalized_key" SET NOT NULL;--> statement-breakpoint

UPDATE "business_sites" SET "country_code" = 'AU' WHERE "country_code" IS NULL;--> statement-breakpoint
ALTER TABLE "business_sites" ALTER COLUMN "country_code" SET DEFAULT 'AU';--> statement-breakpoint
ALTER TABLE "business_sites" ALTER COLUMN "country_code" SET NOT NULL;--> statement-breakpoint

-- Unsupported historical provider identifiers cannot enter the reusable wire
-- contract. Coordinates remain valid manual evidence when provider evidence is
-- incomplete, but provider/place ID must be a supported, complete pair.
UPDATE "ea_audits"
SET
	"site_geocode_provider" = CASE
		WHEN lower(btrim(coalesce("site_geocode_provider", ''))) IN ('geoapify', 'photon')
			AND nullif(btrim(coalesce("site_geocode_place_id", '')), '') IS NOT NULL
			AND "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL
			THEN lower(btrim("site_geocode_provider"))
		ELSE NULL
	END,
	"site_geocode_place_id" = CASE
		WHEN lower(btrim(coalesce("site_geocode_provider", ''))) IN ('geoapify', 'photon')
			AND nullif(btrim(coalesce("site_geocode_place_id", '')), '') IS NOT NULL
			AND "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL
			THEN btrim("site_geocode_place_id")
		ELSE NULL
	END;--> statement-breakpoint
UPDATE "ih_installations"
SET
	"site_geocode_provider" = CASE
		WHEN lower(btrim(coalesce("site_geocode_provider", ''))) IN ('geoapify', 'photon')
			AND nullif(btrim(coalesce("site_geocode_place_id", '')), '') IS NOT NULL
			AND "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL
			THEN lower(btrim("site_geocode_provider"))
		ELSE NULL
	END,
	"site_geocode_place_id" = CASE
		WHEN lower(btrim(coalesce("site_geocode_provider", ''))) IN ('geoapify', 'photon')
			AND nullif(btrim(coalesce("site_geocode_place_id", '')), '') IS NOT NULL
			AND "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL
			THEN btrim("site_geocode_place_id")
		ELSE NULL
	END;--> statement-breakpoint
UPDATE "ss_sites"
SET
	"site_geocode_provider" = CASE
		WHEN lower(btrim(coalesce("site_geocode_provider", ''))) IN ('geoapify', 'photon')
			AND nullif(btrim(coalesce("site_geocode_place_id", '')), '') IS NOT NULL
			AND "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL
			THEN lower(btrim("site_geocode_provider"))
		ELSE NULL
	END,
	"site_geocode_place_id" = CASE
		WHEN lower(btrim(coalesce("site_geocode_provider", ''))) IN ('geoapify', 'photon')
			AND nullif(btrim(coalesce("site_geocode_place_id", '')), '') IS NOT NULL
			AND "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL
			THEN btrim("site_geocode_place_id")
		ELSE NULL
	END;--> statement-breakpoint

-- Recover the richest address evidence first; recency only breaks ties within
-- the same evidence tier.
WITH product_address AS (
	SELECT DISTINCT ON ("site_id") * FROM (
		SELECT
			bj."site_id",
			ea."site_geocode_provider" AS provider,
			ea."site_geocode_place_id" AS place_id,
			ea."site_geocoded_at" AS geocoded_at,
			ea."site_latitude" AS latitude,
			ea."site_longitude" AS longitude,
			bj."updated_at"
		FROM "business_jobs" bj
		JOIN "ea_audits" ea
			ON bj."source_app" = 'ecoaudit'
			AND bj."source_type" = 'audit'
			AND bj."source_id" = ea."id"
		UNION ALL
		SELECT
			bj."site_id",
			ss."site_geocode_provider",
			ss."site_geocode_place_id",
			ss."site_geocoded_at",
			ss."site_latitude",
			ss."site_longitude",
			bj."updated_at"
		FROM "business_jobs" bj
		JOIN "ss_rooftop_assessments" a
			ON bj."source_app" = 'solarsense'
			AND bj."source_type" = 'assessment'
			AND bj."source_id" = a."id"
		JOIN "ss_sites" ss ON ss."id" = a."site_id"
		UNION ALL
		SELECT
			bj."site_id",
			ih."site_geocode_provider",
			ih."site_geocode_place_id",
			ih."site_geocoded_at",
			ih."site_latitude",
			ih."site_longitude",
			bj."updated_at"
		FROM "business_jobs" bj
		JOIN "ih_installations" ih
			ON bj."source_app" = 'installhub'
			AND bj."source_type" = 'installation'
			AND bj."source_id" = ih."id"
	) candidates
	ORDER BY "site_id",
		CASE
			WHEN "latitude" IS NOT NULL AND "longitude" IS NOT NULL
				AND provider IS NOT NULL AND place_id IS NOT NULL THEN 2
			WHEN "latitude" IS NOT NULL AND "longitude" IS NOT NULL THEN 1
			ELSE 0
		END DESC,
		"updated_at" DESC
)
UPDATE "business_sites" bs
SET
	"geocode_provider" = pa.provider,
	"geocode_place_id" = pa.place_id,
	"geocoded_at" = pa.geocoded_at
FROM product_address pa
WHERE pa."site_id" = bs."id";--> statement-breakpoint

CREATE FUNCTION "sw_business_site_address_fingerprint"(
	display_address text,
	locality_value text,
	state_value text,
	postcode_value text,
	country_value text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
	SELECT
		md5(
			lower(regexp_replace(btrim(coalesce(display_address, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(locality_value, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(state_value, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(postcode_value, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(country_value, 'AU')), '[[:space:]]+', ' ', 'g'))
		) || md5(
			lower(regexp_replace(btrim(coalesce(display_address, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(locality_value, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(state_value, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(postcode_value, '')), '[[:space:]]+', ' ', 'g')) || chr(31) ||
			lower(regexp_replace(btrim(coalesce(country_value, 'AU')), '[[:space:]]+', ' ', 'g')) || chr(30) || '2'
		);
$$;--> statement-breakpoint

UPDATE "business_sites"
SET
	"address_source" = CASE
		WHEN "latitude" IS NOT NULL AND "longitude" IS NOT NULL
			AND "geocode_provider" IS NOT NULL AND "geocode_place_id" IS NOT NULL
			THEN 'suggested'
		ELSE 'manual'
	END,
	"geocode_status" = CASE
		WHEN "latitude" IS NOT NULL AND "longitude" IS NOT NULL
			AND "geocode_provider" IS NOT NULL AND "geocode_place_id" IS NOT NULL
			THEN 'resolved'
		WHEN "latitude" IS NOT NULL AND "longitude" IS NOT NULL THEN 'manual'
		ELSE 'unresolved'
	END,
	"address_fingerprint" = "sw_business_site_address_fingerprint"(
		"address", "locality", "state", "postcode", "country_code"
	);--> statement-breakpoint
CREATE FUNCTION "sw_business_site_memory_defaults"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	expected_fingerprint text;
	legacy_address_change boolean := false;
BEGIN
	IF NEW.country_code IS NULL OR btrim(NEW.country_code) = '' THEN
		NEW.country_code := 'AU';
	END IF;
	IF NEW.geocode_provider IS NOT NULL THEN
		NEW.geocode_provider := lower(btrim(NEW.geocode_provider));
		IF NEW.geocode_provider NOT IN ('geoapify', 'photon') THEN
			RAISE EXCEPTION 'unsupported business site geocode provider: %', NEW.geocode_provider
				USING ERRCODE = '23514';
		END IF;
	END IF;
	expected_fingerprint := "sw_business_site_address_fingerprint"(
		NEW.address, NEW.locality, NEW.state, NEW.postcode, NEW.country_code
	);
	IF TG_OP = 'UPDATE' THEN
		legacy_address_change := expected_fingerprint IS DISTINCT FROM OLD.address_fingerprint
			AND NEW.address_fingerprint IS NOT DISTINCT FROM OLD.address_fingerprint;
	END IF;
	IF legacy_address_change THEN
		-- A pre-0049 writer changed address identity without owning the additive
		-- fingerprint/evidence columns. Never retain evidence for the old address.
		NEW.latitude := NULL;
		NEW.longitude := NULL;
		NEW.geocode_provider := NULL;
		NEW.geocode_place_id := NULL;
		NEW.address_source := 'manual';
		NEW.geocode_status := 'unresolved';
		NEW.geocoded_at := NULL;
	END IF;
	IF NEW.address_fingerprint IS NULL OR btrim(NEW.address_fingerprint) = ''
		OR legacy_address_change THEN
		NEW.address_fingerprint := expected_fingerprint;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "business_sites_memory_defaults_trigger"
BEFORE INSERT OR UPDATE
ON "business_sites"
FOR EACH ROW EXECUTE FUNCTION "sw_business_site_memory_defaults"();--> statement-breakpoint
ALTER TABLE "business_sites" ALTER COLUMN "address_fingerprint" SET NOT NULL;--> statement-breakpoint

-- Link legacy products through business_jobs without changing their old IDs.
UPDATE "ea_audits" ea
SET "business_site_id" = bj."site_id"
FROM "business_jobs" bj
WHERE bj."source_app" = 'ecoaudit'
	AND bj."source_type" = 'audit'
	AND bj."source_id" = ea."id";--> statement-breakpoint
UPDATE "ih_installations" ih
SET "business_site_id" = bj."site_id"
FROM "business_jobs" bj
WHERE bj."source_app" = 'installhub'
	AND bj."source_type" = 'installation'
	AND bj."source_id" = ih."id";--> statement-breakpoint
WITH solar_links AS (
	SELECT DISTINCT ON (a."site_id") a."site_id" AS product_site_id, bj."site_id" AS business_site_id
	FROM "business_jobs" bj
	JOIN "ss_rooftop_assessments" a
		ON bj."source_app" = 'solarsense'
		AND bj."source_type" = 'assessment'
		AND bj."source_id" = a."id"
	WHERE a."site_id" IS NOT NULL
	ORDER BY a."site_id", bj."updated_at" DESC
)
UPDATE "ss_sites" ss
SET "business_site_id" = sl.business_site_id
FROM solar_links sl
WHERE sl.product_site_id = ss."id";--> statement-breakpoint

UPDATE "ea_audits" ea
SET "client_name" = bc."name"
FROM "business_sites" bs
JOIN "business_clients" bc ON bc."id" = bs."client_id"
WHERE ea."business_site_id" = bs."id" AND ea."client_name" IS NULL;--> statement-breakpoint
UPDATE "ss_sites" ss
SET "client_name" = bc."name"
FROM "business_sites" bs
JOIN "business_clients" bc ON bc."id" = bs."client_id"
WHERE ss."business_site_id" = bs."id" AND ss."client_name" IS NULL;--> statement-breakpoint

-- Recompute the product fingerprints with the same five-part algorithm used by
-- the API. This is a bounded row rewrite and should be run before peak traffic.
UPDATE "ea_audits"
SET
	"site_address_source" = CASE WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL AND "site_geocode_provider" IS NOT NULL AND "site_geocode_place_id" IS NOT NULL THEN 'suggested' ELSE 'manual' END,
	"site_geocode_status" = CASE WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL AND "site_geocode_provider" IS NOT NULL AND "site_geocode_place_id" IS NOT NULL THEN 'resolved' WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL THEN 'manual' ELSE 'unresolved' END,
	"site_address_fingerprint" = md5(lower(regexp_replace(btrim(coalesce("site_address", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_locality", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_state", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_postcode", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_country_code", 'AU')), '[[:space:]]+', ' ', 'g'))) || md5(lower(regexp_replace(btrim(coalesce("site_address", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_locality", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_state", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_postcode", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_country_code", 'AU')), '[[:space:]]+', ' ', 'g')) || chr(30) || '2');--> statement-breakpoint
UPDATE "ih_installations"
SET
	"site_address_source" = CASE WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL AND "site_geocode_provider" IS NOT NULL AND "site_geocode_place_id" IS NOT NULL THEN 'suggested' ELSE 'manual' END,
	"site_geocode_status" = CASE WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL AND "site_geocode_provider" IS NOT NULL AND "site_geocode_place_id" IS NOT NULL THEN 'resolved' WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL THEN 'manual' ELSE 'unresolved' END,
	"site_address_fingerprint" = md5(lower(regexp_replace(btrim(coalesce("site_address", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_locality", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_state", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_postcode", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_country_code", 'AU')), '[[:space:]]+', ' ', 'g'))) || md5(lower(regexp_replace(btrim(coalesce("site_address", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_locality", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_state", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_postcode", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_country_code", 'AU')), '[[:space:]]+', ' ', 'g')) || chr(30) || '2');--> statement-breakpoint
UPDATE "ss_sites"
SET
	"site_address_source" = CASE WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL AND "site_geocode_provider" IS NOT NULL AND "site_geocode_place_id" IS NOT NULL THEN 'suggested' ELSE 'manual' END,
	"site_geocode_status" = CASE WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL AND "site_geocode_provider" IS NOT NULL AND "site_geocode_place_id" IS NOT NULL THEN 'resolved' WHEN "site_latitude" IS NOT NULL AND "site_longitude" IS NOT NULL THEN 'manual' ELSE 'unresolved' END,
	"site_address_fingerprint" = md5(lower(regexp_replace(btrim(coalesce("location", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_locality", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_state", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_postcode", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_country_code", 'AU')), '[[:space:]]+', ' ', 'g'))) || md5(lower(regexp_replace(btrim(coalesce("location", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_locality", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_state", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_postcode", '')), '[[:space:]]+', ' ', 'g')) || chr(31) || lower(regexp_replace(btrim(coalesce("site_country_code", 'AU')), '[[:space:]]+', ' ', 'g')) || chr(30) || '2');--> statement-breakpoint
ALTER TABLE "business_client_merge_events" ADD CONSTRAINT "business_client_merge_events_source_client_id_business_clients_id_fk" FOREIGN KEY ("source_client_id") REFERENCES "public"."business_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_client_merge_events" ADD CONSTRAINT "business_client_merge_events_target_client_id_business_clients_id_fk" FOREIGN KEY ("target_client_id") REFERENCES "public"."business_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_client_merge_events_company_created_idx" ON "business_client_merge_events" USING btree ("company_key","created_at");--> statement-breakpoint
CREATE INDEX "business_client_merge_events_source_idx" ON "business_client_merge_events" USING btree ("source_client_id");--> statement-breakpoint
CREATE INDEX "business_client_merge_events_target_idx" ON "business_client_merge_events" USING btree ("target_client_id");--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_business_site_id_business_sites_id_fk" FOREIGN KEY ("business_site_id") REFERENCES "public"."business_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_business_site_id_business_sites_id_fk" FOREIGN KEY ("business_site_id") REFERENCES "public"."business_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_clients" ADD CONSTRAINT "business_clients_merged_into_fk" FOREIGN KEY ("merged_into_client_id") REFERENCES "public"."business_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_business_site_id_business_sites_id_fk" FOREIGN KEY ("business_site_id") REFERENCES "public"."business_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ea_audits_business_site_idx" ON "ea_audits" USING btree ("business_site_id","updated_at");--> statement-breakpoint
CREATE INDEX "ih_installations_business_site_idx" ON "ih_installations" USING btree ("business_site_id","updated_at");--> statement-breakpoint
CREATE INDEX "business_clients_company_normalized_idx" ON "business_clients" USING btree ("company_key","normalized_key","merged_into_client_id");--> statement-breakpoint
CREATE INDEX "business_clients_merged_into_idx" ON "business_clients" USING btree ("merged_into_client_id");--> statement-breakpoint
CREATE INDEX "ss_sites_business_site_idx" ON "ss_sites" USING btree ("business_site_id","updated_at");--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_client_name_check" CHECK (
    "ea_audits"."client_name" IS NULL
    OR char_length(btrim("ea_audits"."client_name")) BETWEEN 1 AND 300
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_site_address_source_check" CHECK (
    "ea_audits"."site_address_source" IN ('suggested', 'manual', 'client_saved')
  );--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_site_address_source_check" CHECK (
    "ih_installations"."site_address_source" IN ('suggested', 'manual', 'client_saved')
  );--> statement-breakpoint
ALTER TABLE "business_clients" ADD CONSTRAINT "business_clients_company_key_check" CHECK (
    char_length(btrim("business_clients"."company_key")) BETWEEN 1 AND 100
  );--> statement-breakpoint
ALTER TABLE "business_clients" ADD CONSTRAINT "business_clients_normalized_key_check" CHECK (
    char_length(btrim("business_clients"."normalized_key")) BETWEEN 1 AND 300
  );--> statement-breakpoint
ALTER TABLE "business_clients" ADD CONSTRAINT "business_clients_merge_check" CHECK (
    ("business_clients"."merged_into_client_id" IS NULL AND "business_clients"."merged_at" IS NULL AND "business_clients"."merged_by_user_id" IS NULL)
    OR (
      "business_clients"."merged_into_client_id" IS NOT NULL
      AND "business_clients"."merged_into_client_id" <> "business_clients"."id"
      AND "business_clients"."merged_at" IS NOT NULL
    )
  );--> statement-breakpoint
ALTER TABLE "business_sites" ADD CONSTRAINT "business_sites_address_source_check" CHECK (
    "business_sites"."address_source" IN ('suggested', 'manual', 'client_saved')
  );--> statement-breakpoint
ALTER TABLE "business_sites" ADD CONSTRAINT "business_sites_geocode_status_check" CHECK (
    "business_sites"."geocode_status" IN ('unresolved', 'resolved', 'manual', 'failed')
  );--> statement-breakpoint
ALTER TABLE "business_sites" ADD CONSTRAINT "business_sites_geocode_evidence_check" CHECK (
    ("business_sites"."geocode_status" <> 'resolved')
    OR (
      "business_sites"."latitude" IS NOT NULL
      AND "business_sites"."longitude" IS NOT NULL
      AND "business_sites"."geocode_provider" IS NOT NULL
      AND "business_sites"."geocode_place_id" IS NOT NULL
    )
  );--> statement-breakpoint
ALTER TABLE "business_sites" ADD CONSTRAINT "business_sites_suggested_evidence_check" CHECK (
    ("business_sites"."address_source" <> 'suggested')
    OR (
      "business_sites"."geocode_status" = 'resolved'
      AND "business_sites"."latitude" IS NOT NULL
      AND "business_sites"."longitude" IS NOT NULL
      AND "business_sites"."geocode_provider" IS NOT NULL
      AND "business_sites"."geocode_place_id" IS NOT NULL
    )
  );--> statement-breakpoint
ALTER TABLE "business_sites" ADD CONSTRAINT "business_sites_address_fingerprint_check" CHECK (
    "business_sites"."address_fingerprint" ~ '^[0-9a-f]{64}$'
  );--> statement-breakpoint
ALTER TABLE "business_sites" ADD CONSTRAINT "business_sites_country_check" CHECK ("business_sites"."country_code" = 'AU');--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_client_name_check" CHECK (
    "ss_sites"."client_name" IS NULL
    OR char_length(btrim("ss_sites"."client_name")) BETWEEN 1 AND 300
  );--> statement-breakpoint
ALTER TABLE "ss_sites" ADD CONSTRAINT "ss_sites_address_source_check" CHECK (
    "ss_sites"."site_address_source" IN ('suggested', 'manual', 'client_saved')
  );
