CREATE TABLE "business_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_clients_name_check" CHECK (char_length(btrim("business_clients"."name")) BETWEEN 1 AND 300),
	CONSTRAINT "business_clients_contact_check" CHECK (
    ("business_clients"."contact_name" IS NULL OR char_length(btrim("business_clients"."contact_name")) BETWEEN 1 AND 300)
    AND ("business_clients"."contact_phone" IS NULL OR char_length(btrim("business_clients"."contact_phone")) BETWEEN 1 AND 50)
    AND ("business_clients"."contact_email" IS NULL OR char_length(btrim("business_clients"."contact_email")) BETWEEN 1 AND 320)
  )
);
--> statement-breakpoint
CREATE TABLE "business_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"job_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"source_app" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_jobs_type_check" CHECK ("business_jobs"."job_type" IN ('field', 'ecoaudit', 'solarsense')),
	CONSTRAINT "business_jobs_source_app_check" CHECK ("business_jobs"."source_app" IN ('installhub', 'ecoaudit', 'solarsense')),
	CONSTRAINT "business_jobs_status_check" CHECK ("business_jobs"."status" IN ('planned', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "business_jobs_title_check" CHECK (char_length(btrim("business_jobs"."title")) BETWEEN 1 AND 300),
	CONSTRAINT "business_jobs_description_check" CHECK ("business_jobs"."description" IS NULL OR char_length("business_jobs"."description") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "business_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"locality" text,
	"state" text,
	"postcode" text,
	"country_code" text,
	"latitude" double precision,
	"longitude" double precision,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"access_information" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_sites_name_check" CHECK (char_length(btrim("business_sites"."name")) BETWEEN 1 AND 300),
	CONSTRAINT "business_sites_address_check" CHECK (char_length(btrim("business_sites"."address")) BETWEEN 1 AND 1000),
	CONSTRAINT "business_sites_timezone_check" CHECK (char_length(btrim("business_sites"."timezone")) BETWEEN 1 AND 100),
	CONSTRAINT "business_sites_state_check" CHECK ("business_sites"."state" IS NULL OR "business_sites"."state" IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')),
	CONSTRAINT "business_sites_postcode_check" CHECK ("business_sites"."postcode" IS NULL OR "business_sites"."postcode" ~ '^[0-9]{4}$'),
	CONSTRAINT "business_sites_country_check" CHECK ("business_sites"."country_code" IS NULL OR "business_sites"."country_code" = 'AU'),
	CONSTRAINT "business_sites_coordinates_check" CHECK (
    ("business_sites"."latitude" IS NULL AND "business_sites"."longitude" IS NULL)
    OR (
      "business_sites"."latitude" IS NOT NULL
      AND "business_sites"."longitude" IS NOT NULL
      AND "business_sites"."latitude" BETWEEN -44 AND -9
      AND "business_sites"."longitude" BETWEEN 112 AND 154
    )
  ),
	CONSTRAINT "business_sites_contact_check" CHECK (
    ("business_sites"."contact_name" IS NULL OR char_length(btrim("business_sites"."contact_name")) BETWEEN 1 AND 300)
    AND ("business_sites"."contact_phone" IS NULL OR char_length(btrim("business_sites"."contact_phone")) BETWEEN 1 AND 50)
    AND ("business_sites"."contact_email" IS NULL OR char_length(btrim("business_sites"."contact_email")) BETWEEN 1 AND 320)
    AND ("business_sites"."access_information" IS NULL OR char_length(btrim("business_sites"."access_information")) BETWEEN 1 AND 5000)
  )
);
--> statement-breakpoint
CREATE TABLE "ecoaudit_job_details" (
	"job_id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ecoaudit_job_details_audit_id_unique" UNIQUE("audit_id")
);
--> statement-breakpoint
CREATE TABLE "field_app_job_details" (
	"job_id" text PRIMARY KEY NOT NULL,
	"work_type" text NOT NULL,
	"maas" boolean,
	"metering_solution_type" text,
	"planned_meter_type" text,
	"job_comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_app_job_details_work_type_check" CHECK (char_length(btrim("field_app_job_details"."work_type")) BETWEEN 1 AND 120),
	CONSTRAINT "field_app_job_details_metering_solution_check" CHECK ("field_app_job_details"."metering_solution_type" IS NULL OR char_length(btrim("field_app_job_details"."metering_solution_type")) BETWEEN 1 AND 120),
	CONSTRAINT "field_app_job_details_planned_meter_check" CHECK ("field_app_job_details"."planned_meter_type" IS NULL OR char_length(btrim("field_app_job_details"."planned_meter_type")) BETWEEN 1 AND 120),
	CONSTRAINT "field_app_job_details_comments_check" CHECK ("field_app_job_details"."job_comments" IS NULL OR char_length(btrim("field_app_job_details"."job_comments")) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "solarsense_job_details" (
	"job_id" text PRIMARY KEY NOT NULL,
	"assessment_id" text NOT NULL,
	"building_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "solarsense_job_details_assessment_id_unique" UNIQUE("assessment_id"),
	CONSTRAINT "solarsense_job_details_building_check" CHECK ("solarsense_job_details"."building_name" IS NULL OR char_length(btrim("solarsense_job_details"."building_name")) BETWEEN 1 AND 300)
);
--> statement-breakpoint
ALTER TABLE "portal_schedule_events" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "business_jobs" ADD CONSTRAINT "business_jobs_site_id_business_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."business_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_sites" ADD CONSTRAINT "business_sites_client_id_business_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."business_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecoaudit_job_details" ADD CONSTRAINT "ecoaudit_job_details_job_id_business_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."business_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_app_job_details" ADD CONSTRAINT "field_app_job_details_job_id_business_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."business_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solarsense_job_details" ADD CONSTRAINT "solarsense_job_details_job_id_business_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."business_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_clients_name_idx" ON "business_clients" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "business_jobs_source_unique" ON "business_jobs" USING btree ("source_app","source_type","source_id");--> statement-breakpoint
CREATE INDEX "business_jobs_site_idx" ON "business_jobs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "business_jobs_type_status_idx" ON "business_jobs" USING btree ("job_type","status");--> statement-breakpoint
CREATE INDEX "business_sites_client_idx" ON "business_sites" USING btree ("client_id","name");--> statement-breakpoint
ALTER TABLE "portal_schedule_events" ADD CONSTRAINT "portal_schedule_events_job_id_business_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."business_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_schedule_events_job_idx" ON "portal_schedule_events" USING btree ("job_id");--> statement-breakpoint

-- Preserve legacy product records while projecting them into the shared hierarchy.
-- Clients are grouped only where an authoritative legacy client name exists.
INSERT INTO "business_clients" ("id", "name", "created_at", "updated_at")
SELECT
	'bc_ih_' || md5(COALESCE(NULLIF(lower(btrim("client_name")), ''), 'legacy-record:' || "id")),
	left(COALESCE(NULLIF(min(btrim("client_name")), ''), 'Legacy client'), 300),
	min("created_at"),
	max("updated_at")
FROM "ih_installations"
WHERE "deleted_at" IS NULL
GROUP BY COALESCE(NULLIF(lower(btrim("client_name")), ''), 'legacy-record:' || "id");--> statement-breakpoint

INSERT INTO "business_clients" ("id", "name", "created_at", "updated_at")
SELECT
	'bc_ea_' || md5("id"),
	left(COALESCE(NULLIF(btrim("site_name"), ''), 'Legacy EcoAudit site'), 300),
	"created_at",
	"updated_at"
FROM "ea_audits"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "business_clients" ("id", "name", "created_at", "updated_at")
SELECT
	'bc_ss_' || md5("id"),
	left(COALESCE(NULLIF(btrim("site_name"), ''), 'Legacy SolarSense site'), 300),
	"created_at",
	"updated_at"
FROM "ss_sites"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "business_clients" ("id", "name", "created_at", "updated_at")
SELECT
	'bc_ssa_' || md5(a."id"),
	left(COALESCE(NULLIF(btrim(a."site_name"), ''), 'Legacy SolarSense site'), 300),
	a."created_at",
	a."updated_at"
FROM "ss_rooftop_assessments" a
LEFT JOIN "ss_sites" s ON s."id" = a."site_id" AND s."deleted_at" IS NULL
WHERE a."deleted_at" IS NULL AND s."id" IS NULL;--> statement-breakpoint

INSERT INTO "business_sites" (
	"id", "client_id", "name", "address", "locality", "state", "postcode",
	"country_code", "latitude", "longitude", "timezone", "contact_name",
	"contact_phone", "contact_email", "access_information", "created_at", "updated_at"
)
SELECT
	'bs_ih_' || md5("id"),
	'bc_ih_' || md5(COALESCE(NULLIF(lower(btrim("client_name")), ''), 'legacy-record:' || "id")),
	left(COALESCE(NULLIF(btrim("site_name"), ''), 'Legacy Field site'), 300),
	left(COALESCE(NULLIF(btrim("site_address"), ''), 'Address unavailable'), 1000),
	"site_locality", "site_state", "site_postcode", "site_country_code",
	"site_latitude", "site_longitude", COALESCE(NULLIF(btrim("timezone"), ''), 'Australia/Sydney'), "site_contact_name",
	"site_contact_phone", "site_contact_email", "access_information", "created_at", "updated_at"
FROM "ih_installations"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "business_sites" (
	"id", "client_id", "name", "address", "locality", "state", "postcode",
	"country_code", "latitude", "longitude", "created_at", "updated_at"
)
SELECT
	'bs_ea_' || md5("id"),
	'bc_ea_' || md5("id"),
	left(COALESCE(NULLIF(btrim("site_name"), ''), 'Legacy EcoAudit site'), 300),
	left(COALESCE(NULLIF(btrim("site_address"), ''), 'Address unavailable'), 1000),
	"site_locality", "site_state", "site_postcode", "site_country_code",
	"site_latitude", "site_longitude", "created_at", "updated_at"
FROM "ea_audits"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "business_sites" (
	"id", "client_id", "name", "address", "locality", "state", "postcode",
	"country_code", "latitude", "longitude", "created_at", "updated_at"
)
SELECT
	'bs_ss_' || md5("id"),
	'bc_ss_' || md5("id"),
	left(COALESCE(NULLIF(btrim("site_name"), ''), 'Legacy SolarSense site'), 300),
	left(COALESCE(NULLIF(btrim("location"), ''), 'Address unavailable'), 1000),
	"site_locality", "site_state", "site_postcode", "site_country_code",
	"site_latitude", "site_longitude", "created_at", "updated_at"
FROM "ss_sites"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "business_sites" (
	"id", "client_id", "name", "address", "created_at", "updated_at"
)
SELECT
	'bs_ssa_' || md5(a."id"),
	'bc_ssa_' || md5(a."id"),
	left(COALESCE(NULLIF(btrim(a."site_name"), ''), 'Legacy SolarSense site'), 300),
	'Address unavailable',
	a."created_at",
	a."updated_at"
FROM "ss_rooftop_assessments" a
LEFT JOIN "ss_sites" s ON s."id" = a."site_id" AND s."deleted_at" IS NULL
WHERE a."deleted_at" IS NULL AND s."id" IS NULL;--> statement-breakpoint

INSERT INTO "business_jobs" (
	"id", "site_id", "job_type", "title", "status", "source_app", "source_type",
	"source_id", "created_by_user_id", "created_at", "updated_at"
)
SELECT
	'bj_ih_' || md5("id"),
	'bs_ih_' || md5("id"),
	'field',
	left(COALESCE(NULLIF(btrim("client_name"), ''), 'Legacy client') || ' · ' || COALESCE(NULLIF(btrim("site_name"), ''), 'Legacy Field site'), 300),
	CASE WHEN "status" = 'Completed' THEN 'done' ELSE 'planned' END,
	'installhub', 'installation', "id", "created_by_user_id", "created_at", "updated_at"
FROM "ih_installations"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "business_jobs" (
	"id", "site_id", "job_type", "title", "status", "source_app", "source_type",
	"source_id", "created_by_user_id", "created_at", "updated_at"
)
SELECT
	'bj_ea_' || md5("id"),
	'bs_ea_' || md5("id"),
	'ecoaudit', left(COALESCE(NULLIF(btrim("site_name"), ''), 'Legacy EcoAudit site'), 300),
	CASE WHEN "status" = 'Completed' THEN 'done' ELSE 'planned' END,
	'ecoaudit', 'audit', "id", "created_by_user_id", "created_at", "updated_at"
FROM "ea_audits"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "business_jobs" (
	"id", "site_id", "job_type", "title", "status", "source_app", "source_type",
	"source_id", "created_by_user_id", "created_at", "updated_at"
)
SELECT
	'bj_ss_' || md5(a."id"),
	CASE WHEN s."id" IS NULL THEN 'bs_ssa_' || md5(a."id") ELSE 'bs_ss_' || md5(s."id") END,
	'solarsense', left(btrim(a."site_name") || ' · ' || btrim(a."building_id_name"), 300),
	CASE WHEN a."status" = 'Completed' THEN 'done' ELSE 'planned' END,
	'solarsense', 'assessment', a."id", a."created_by_user_id", a."created_at", a."updated_at"
FROM "ss_rooftop_assessments" a
LEFT JOIN "ss_sites" s ON s."id" = a."site_id" AND s."deleted_at" IS NULL
WHERE a."deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "field_app_job_details" (
	"job_id", "work_type", "maas", "metering_solution_type", "planned_meter_type",
	"job_comments", "created_at", "updated_at"
)
SELECT
	'bj_ih_' || md5("id"),
	COALESCE(NULLIF(btrim("service_type"), ''), 'legacy_unclassified'),
	"maas", "metering_solution_type", "planned_meter_type", "job_comments", "created_at", "updated_at"
FROM "ih_installations"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "ecoaudit_job_details" ("job_id", "audit_id", "created_at")
SELECT 'bj_ea_' || md5("id"), "id", "created_at"
FROM "ea_audits"
WHERE "deleted_at" IS NULL;--> statement-breakpoint

INSERT INTO "solarsense_job_details" ("job_id", "assessment_id", "building_name", "created_at")
SELECT 'bj_ss_' || md5(a."id"), a."id", left(btrim(a."building_id_name"), 300), a."created_at"
FROM "ss_rooftop_assessments" a
WHERE a."deleted_at" IS NULL;--> statement-breakpoint

UPDATE "portal_schedule_events" e
SET "job_id" = j."id"
FROM "business_jobs" j
WHERE e."source_app" = j."source_app"
	AND e."source_type" = j."source_type"
	AND e."source_id" = j."source_id";
