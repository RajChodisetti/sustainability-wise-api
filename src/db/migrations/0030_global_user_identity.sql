-- Canonical cross-product identity. The released product user tables remain
-- the authorization subjects used by their existing mobile/API contracts;
-- global_users ties one projection in each product to one person.
CREATE TABLE "global_users" (
	"id" text PRIMARY KEY NOT NULL,
	"login_key" text NOT NULL,
	"field_user_id" text NOT NULL,
	"primary_origin_app" text NOT NULL,
	"primary_origin_user_id" text NOT NULL,
	"display_email" text NOT NULL,
	"full_name" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"fleet_entitled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "global_users_primary_origin_app_check" CHECK (
		"primary_origin_app" IN ('ecoaudit', 'solarsense', 'installhub')
	),
	CONSTRAINT "global_users_role_check" CHECK (
		"role" IN ('admin', 'inspector')
	)
);
--> statement-breakpoint
CREATE TABLE "global_user_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"global_user_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Add nullable first: every existing registry row is globalized below before
-- the final NOT NULL/FK constraints are installed.
ALTER TABLE "unified_users" ADD COLUMN "global_user_id" text;
--> statement-breakpoint
-- Scheduler-owned Solar assignment ships in this same generated schema step,
-- so the 0030 snapshot and the actual migration chain remain coherent.
ALTER TABLE "ss_rooftop_assessments"
	ADD COLUMN "assigned_inspector_user_id" text;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "global_identity_login_key"(login_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
	normalized text := lower(btrim(login_value));
	local_login text[];
BEGIN
	local_login := regexp_match(
		normalized,
		'^([^@]+)@(ecoaudit|solarsense|installhub)\.users\.local$'
	);
	IF local_login IS NOT NULL THEN
		RETURN 'username:' || local_login[1];
	END IF;
	IF strpos(normalized, '@') = 0 THEN
		RETURN 'username:' || normalized;
	END IF;
	RETURN 'email:' || normalized;
END
$$;
--> statement-breakpoint

-- Product aliases remain app-specific for username logins. A deterministic
-- internal alias is used only for a genuinely ambiguous legacy duplicate;
-- authentication resolves the canonical login key rather than that alias.
CREATE OR REPLACE FUNCTION "global_identity_projection_email"(
	identity_login_key text,
	application_name text,
	identity_id text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
	identity_count integer;
BEGIN
	SELECT count(*)::integer
	INTO identity_count
	FROM "public"."global_users"
	WHERE "login_key" = identity_login_key;

	IF identity_count > 1 THEN
		RETURN 'global-' || substr(md5(identity_id), 1, 24)
			|| '@' || application_name || '.users.local';
	END IF;
	IF identity_login_key LIKE 'username:%' THEN
		RETURN substr(identity_login_key, length('username:') + 1)
			|| '@' || application_name || '.users.local';
	END IF;
	RETURN substr(identity_login_key, length('email:') + 1);
END
$$;
--> statement-breakpoint

-- Stop the one-origin mirror before the locked backfill mutates projections.
-- Reads remain available; writers wait until canonical identities, all three
-- projections, and the replacement trigger are committed together.
LOCK TABLE
	"ea_users", "ss_users", "ih_users", "unified_users",
	"ih_installations", "ih_installation_work_sessions",
	"ih_meter_history_events", "ih_completion_idempotency",
	"ih_job_finance", "ih_job_cost_lines", "ih_invoices",
	"portal_schedule_events", "api_keys", "record_versions", "pdf_jobs",
	"refresh_tokens"
	IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ea_users_sync_unified_users" ON "ea_users";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ss_users_sync_unified_users" ON "ss_users";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ih_users_sync_unified_users" ON "ih_users";
--> statement-breakpoint

-- Same normalized login keys are paired across products. The preflight below
-- rejects duplicate keys inside one product rather than guessing an ordinal.
CREATE TEMP TABLE "global_identity_source" ON COMMIT DROP AS
WITH source_users AS (
	SELECT 'ecoaudit'::text AS origin_app, id, email, password_hash,
		full_name, role, is_active, created_at, updated_at
	FROM "ea_users"
	UNION ALL
	SELECT 'solarsense'::text, id, email, password_hash,
		full_name, role, is_active, created_at, updated_at
	FROM "ss_users"
	UNION ALL
	SELECT 'installhub'::text, id, email, password_hash,
		full_name, role, is_active, created_at, updated_at
	FROM "ih_users"
), keyed AS (
	SELECT *, "public"."global_identity_login_key"(email) AS login_key
	FROM source_users
)
SELECT *, 1::integer AS identity_ordinal
FROM keyed;
--> statement-breakpoint

-- A same-product duplicate cannot be paired safely: created_at order says
-- nothing about whether two accounts are one person. Abort with a diagnostic
-- for explicit reconciliation instead of merging credentials or privilege.
DO $$
DECLARE
	ambiguous record;
BEGIN
	SELECT login_key, origin_app, count(*)::integer AS duplicate_count
	INTO ambiguous
	FROM "global_identity_source"
	GROUP BY login_key, origin_app
	HAVING count(*) > 1
	ORDER BY login_key, origin_app
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION
			'Ambiguous legacy global identity (% in %, % rows); reconcile before migration',
			ambiguous.login_key, ambiguous.origin_app, ambiguous.duplicate_count
			USING ERRCODE = '23505';
	END IF;
END
$$;
--> statement-breakpoint

-- Active/inactive is a security boundary. Conflicting legacy states are not
-- resolved by OR/AND because either choice silently surprises one product.
DO $$
DECLARE
	conflicting record;
BEGIN
	SELECT login_key, count(*)::integer AS membership_count
	INTO conflicting
	FROM "global_identity_source"
	GROUP BY login_key
	HAVING bool_or(is_active) <> bool_and(is_active)
	ORDER BY login_key
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION
			'Conflicting active state for legacy global identity (% across % rows); reconcile before migration',
			conflicting.login_key, conflicting.membership_count
			USING ERRCODE = '23514';
	END IF;
END
$$;
--> statement-breakpoint

CREATE TEMP TABLE "global_identity_groups" ON COMMIT DROP AS
SELECT
	s.login_key,
	s.identity_ordinal,
	'global-user:'
		|| (array_agg(s.origin_app ORDER BY
			CASE s.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END,
			s.created_at, s.id))[1]
		|| ':'
		|| (array_agg(s.id ORDER BY
			CASE s.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END,
			s.created_at, s.id))[1] AS global_user_id,
	COALESCE(
		(array_agg(s.id ORDER BY s.created_at, s.id)
			FILTER (WHERE s.origin_app = 'installhub'))[1],
		'unified-field:'
			|| (array_agg(s.origin_app ORDER BY
				CASE s.origin_app WHEN 'ecoaudit' THEN 1 WHEN 'solarsense' THEN 2 ELSE 3 END,
				s.created_at, s.id))[1]
			|| ':'
			|| (array_agg(s.id ORDER BY
				CASE s.origin_app WHEN 'ecoaudit' THEN 1 WHEN 'solarsense' THEN 2 ELSE 3 END,
				s.created_at, s.id))[1]
	) AS field_user_id,
	(array_agg(s.origin_app ORDER BY
		CASE s.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END,
		s.created_at, s.id))[1] AS primary_origin_app,
	(array_agg(s.id ORDER BY
		CASE s.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END,
		s.created_at, s.id))[1] AS primary_origin_user_id,
	(array_agg(s.email ORDER BY
		CASE s.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END,
		s.created_at, s.id))[1] AS display_email,
	(array_agg(s.full_name ORDER BY
		CASE s.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END,
		s.created_at, s.id) FILTER (WHERE s.full_name IS NOT NULL))[1] AS full_name,
	CASE WHEN bool_or(s.role = 'admin') THEN 'admin' ELSE 'inspector' END AS role,
	bool_and(s.is_active) AS is_active,
	bool_or(
		s.origin_app IN ('ecoaudit', 'solarsense')
		AND s.role = 'admin'
		AND s.is_active
	) AS fleet_entitled,
	min(s.created_at) AS created_at,
	max(s.updated_at) AS updated_at,
	(array_agg(s.password_hash ORDER BY
		CASE s.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END,
		s.created_at, s.id))[1] AS projection_password_hash
FROM "global_identity_source" s
GROUP BY s.login_key, s.identity_ordinal;
--> statement-breakpoint

INSERT INTO "global_users" (
	"id", "login_key", "field_user_id", "primary_origin_app",
	"primary_origin_user_id", "display_email", "full_name", "role",
	"is_active", "fleet_entitled", "created_at", "updated_at"
)
SELECT global_user_id, login_key, field_user_id, primary_origin_app,
	primary_origin_user_id, display_email, full_name, role, is_active,
	fleet_entitled, created_at, updated_at
FROM "global_identity_groups";
--> statement-breakpoint

-- Preserve every pre-migration bcrypt hash. This makes each legacy credential
-- valid in every product without pretending separately salted hashes differ.
INSERT INTO "global_user_credentials" (
	"id", "global_user_id", "password_hash", "created_at"
)
SELECT DISTINCT
	'global-credential:' || md5(g.global_user_id || ':' || s.password_hash),
	g.global_user_id,
	s.password_hash,
	CURRENT_TIMESTAMP
FROM "global_identity_source" s
JOIN "global_identity_groups" g
	USING (login_key, identity_ordinal);
--> statement-breakpoint

-- Capture every pre-0030 Field subject before unified_users is rewritten.
-- Existing owner/assignee/actor rows use these FK-less IDs directly.
CREATE TEMP TABLE "global_field_id_aliases" ON COMMIT DROP AS
SELECT DISTINCT
	u.field_user_id AS old_field_user_id,
	g.field_user_id AS canonical_field_user_id
FROM "global_identity_source" s
JOIN "global_identity_groups" g
	USING (login_key, identity_ordinal)
JOIN "unified_users" u
	ON u.origin_app = s.origin_app AND u.origin_user_id = s.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "global_field_id_aliases_old_unique"
	ON "global_field_id_aliases" (old_field_user_id);
--> statement-breakpoint

-- Lifecycle idempotency evidence is immutable. If two former aliases would
-- collapse onto one scope key, abort for explicit reconciliation rather than
-- choosing a winner or discarding a possibly different result.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ih_completion_idempotency" row
		JOIN "global_field_id_aliases" alias
			ON alias.old_field_user_id = row.actor_user_id
		GROUP BY row.installation_id, row.operation,
			alias.canonical_field_user_id, row.idempotency_key
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION
			'Canonical Field identity would collide in ih_completion_idempotency; reconcile before migration'
			USING ERRCODE = '23505';
	END IF;
END
$$;
--> statement-breakpoint

-- Separate statements avoid a sparse multi-column join producing a Cartesian
-- update when different legacy aliases occur on the same installation.
UPDATE "ih_installations" row SET created_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.created_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_installations" row SET assigned_inspector_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.assigned_inspector_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_installations" row SET completed_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.completed_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_installations" row SET reopened_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.reopened_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_installation_work_sessions" row SET actor_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.actor_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_meter_history_events" row SET actor_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.actor_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_completion_idempotency" row SET actor_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.actor_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_job_finance" row SET updated_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.updated_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_job_cost_lines" row SET created_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.created_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "ih_invoices" row SET created_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.created_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "portal_schedule_events" row SET assignee_field_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.assignee_field_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "portal_schedule_events" row SET created_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.created_by_app = 'installhub'
	AND row.created_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "api_keys" row SET created_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.app = 'installhub' AND row.created_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "record_versions" row SET created_by_user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.app = 'installhub' AND row.created_by_user_id = alias.old_field_user_id;
--> statement-breakpoint
UPDATE "pdf_jobs" row SET user_id = alias.canonical_field_user_id
FROM "global_field_id_aliases" alias
WHERE row.app = 'installhub'
	AND row.user_id = alias.old_field_user_id
	AND alias.old_field_user_id <> alias.canonical_field_user_id;
--> statement-breakpoint
-- A refresh JWT embeds its old subject and cannot be rewritten. Revoke it
-- atomically; the user logs in again with the same preserved credential and
-- receives the correct product ID.
UPDATE "refresh_tokens" row SET
	revoked_at = COALESCE(row.revoked_at, CURRENT_TIMESTAMP)
FROM "global_field_id_aliases" alias
WHERE row.app = 'installhub' AND row.user_id = alias.old_field_user_id;
--> statement-breakpoint

-- Build the complete projection map while preserving every existing product
-- user ID. Missing projections get deterministic IDs; Field's projection ID
-- is always the canonical Field authorization subject.
CREATE TEMP TABLE "global_identity_memberships" ON COMMIT DROP AS
SELECT g.global_user_id, g.field_user_id, s.origin_app, s.id AS origin_user_id,
	g.login_key, g.full_name, g.role, g.is_active, g.created_at, g.updated_at,
	g.projection_password_hash, true AS existed_before
FROM "global_identity_source" s
JOIN "global_identity_groups" g
	USING (login_key, identity_ordinal)
UNION ALL
SELECT g.global_user_id, g.field_user_id, applications.origin_app,
	CASE
		WHEN applications.origin_app = 'installhub' THEN g.field_user_id
		ELSE 'global-projection:' || applications.origin_app || ':'
			|| substr(md5(g.global_user_id), 1, 32)
	END,
	g.login_key, g.full_name, g.role, g.is_active, g.created_at, g.updated_at,
	g.projection_password_hash, false
FROM "global_identity_groups" g
CROSS JOIN (
	VALUES ('ecoaudit'::text), ('solarsense'::text), ('installhub'::text)
) AS applications(origin_app)
WHERE NOT EXISTS (
	SELECT 1
	FROM "global_identity_source" s
	WHERE s.login_key = g.login_key
		AND s.identity_ordinal = g.identity_ordinal
		AND s.origin_app = applications.origin_app
);
--> statement-breakpoint

-- Field's product row must use field_user_id. A pre-existing Field row was
-- selected as that ID above; only missing Field projections are inserted here.
INSERT INTO "ea_users" (
	"id", "email", "password_hash", "full_name", "role", "is_active",
	"created_at", "updated_at"
)
SELECT m.origin_user_id,
	"public"."global_identity_projection_email"(
		m.login_key, 'ecoaudit', m.global_user_id
	),
	m.projection_password_hash, m.full_name, m.role, m.is_active,
	m.created_at, m.updated_at
FROM "global_identity_memberships" m
WHERE m.origin_app = 'ecoaudit' AND NOT m.existed_before;
--> statement-breakpoint
INSERT INTO "ss_users" (
	"id", "email", "password_hash", "full_name", "role", "is_active",
	"created_at", "updated_at"
)
SELECT m.origin_user_id,
	"public"."global_identity_projection_email"(
		m.login_key, 'solarsense', m.global_user_id
	),
	m.projection_password_hash, m.full_name, m.role, m.is_active,
	m.created_at, m.updated_at
FROM "global_identity_memberships" m
WHERE m.origin_app = 'solarsense' AND NOT m.existed_before;
--> statement-breakpoint
INSERT INTO "ih_users" (
	"id", "email", "password_hash", "full_name", "role", "is_active",
	"created_at", "updated_at"
)
SELECT m.origin_user_id,
	"public"."global_identity_projection_email"(
		m.login_key, 'installhub', m.global_user_id
	),
	m.projection_password_hash, m.full_name, m.role, m.is_active,
	m.created_at, m.updated_at
FROM "global_identity_memberships" m
WHERE m.origin_app = 'installhub' AND NOT m.existed_before;
--> statement-breakpoint

-- Role and active state converge globally. Existing password hashes stay in
-- place until an explicit password change, preserving all released credentials.
UPDATE "ea_users" u
SET "full_name" = m.full_name, "role" = m.role, "is_active" = m.is_active,
	"updated_at" = GREATEST(u."updated_at", m.updated_at)
FROM "global_identity_memberships" m
WHERE m.origin_app = 'ecoaudit' AND m.origin_user_id = u."id";
--> statement-breakpoint
UPDATE "ss_users" u
SET "full_name" = m.full_name, "role" = m.role, "is_active" = m.is_active,
	"updated_at" = GREATEST(u."updated_at", m.updated_at)
FROM "global_identity_memberships" m
WHERE m.origin_app = 'solarsense' AND m.origin_user_id = u."id";
--> statement-breakpoint
UPDATE "ih_users" u
SET "full_name" = m.full_name, "role" = m.role, "is_active" = m.is_active,
	"updated_at" = GREATEST(u."updated_at", m.updated_at)
FROM "global_identity_memberships" m
WHERE m.origin_app = 'installhub' AND m.origin_user_id = u."id";
--> statement-breakpoint

-- Canonical reference remapping is complete and all projection IDs are known;
-- the registry can now carry three rows with one shared Field subject.
DROP INDEX "unified_users_field_user_unique";
--> statement-breakpoint

-- Rebuild/upsert the compatibility memberships from the now-complete product
-- projections. All three rows share field_user_id and global_user_id.
INSERT INTO "unified_users" (
	"id", "global_user_id", "origin_app", "origin_user_id",
	"field_user_id", "email", "password_hash", "full_name", "role",
	"is_active", "source_created_at", "source_updated_at", "synced_at",
	"deleted_at", "sync_version"
)
SELECT 'unified-user:ecoaudit:' || u.id, m.global_user_id, 'ecoaudit', u.id,
	m.field_user_id, u.email, u.password_hash, u.full_name, u.role, u.is_active,
	u.created_at, u.updated_at, CURRENT_TIMESTAMP, NULL, 1
FROM "ea_users" u
JOIN "global_identity_memberships" m
	ON m.origin_app = 'ecoaudit' AND m.origin_user_id = u.id
ON CONFLICT ("origin_app", "origin_user_id") DO UPDATE SET
	"global_user_id" = EXCLUDED."global_user_id",
	"field_user_id" = EXCLUDED."field_user_id",
	"email" = EXCLUDED."email", "password_hash" = EXCLUDED."password_hash",
	"full_name" = EXCLUDED."full_name", "role" = EXCLUDED."role",
	"is_active" = EXCLUDED."is_active", "source_updated_at" = EXCLUDED."source_updated_at",
	"synced_at" = CURRENT_TIMESTAMP, "deleted_at" = NULL,
	"sync_version" = "unified_users"."sync_version" + 1;
--> statement-breakpoint
INSERT INTO "unified_users" (
	"id", "global_user_id", "origin_app", "origin_user_id",
	"field_user_id", "email", "password_hash", "full_name", "role",
	"is_active", "source_created_at", "source_updated_at", "synced_at",
	"deleted_at", "sync_version"
)
SELECT 'unified-user:solarsense:' || u.id, m.global_user_id, 'solarsense', u.id,
	m.field_user_id, u.email, u.password_hash, u.full_name, u.role, u.is_active,
	u.created_at, u.updated_at, CURRENT_TIMESTAMP, NULL, 1
FROM "ss_users" u
JOIN "global_identity_memberships" m
	ON m.origin_app = 'solarsense' AND m.origin_user_id = u.id
ON CONFLICT ("origin_app", "origin_user_id") DO UPDATE SET
	"global_user_id" = EXCLUDED."global_user_id",
	"field_user_id" = EXCLUDED."field_user_id",
	"email" = EXCLUDED."email", "password_hash" = EXCLUDED."password_hash",
	"full_name" = EXCLUDED."full_name", "role" = EXCLUDED."role",
	"is_active" = EXCLUDED."is_active", "source_updated_at" = EXCLUDED."source_updated_at",
	"synced_at" = CURRENT_TIMESTAMP, "deleted_at" = NULL,
	"sync_version" = "unified_users"."sync_version" + 1;
--> statement-breakpoint
INSERT INTO "unified_users" (
	"id", "global_user_id", "origin_app", "origin_user_id",
	"field_user_id", "email", "password_hash", "full_name", "role",
	"is_active", "source_created_at", "source_updated_at", "synced_at",
	"deleted_at", "sync_version"
)
SELECT 'unified-user:installhub:' || u.id, m.global_user_id, 'installhub', u.id,
	m.field_user_id, u.email, u.password_hash, u.full_name, u.role, u.is_active,
	u.created_at, u.updated_at, CURRENT_TIMESTAMP, NULL, 1
FROM "ih_users" u
JOIN "global_identity_memberships" m
	ON m.origin_app = 'installhub' AND m.origin_user_id = u.id
ON CONFLICT ("origin_app", "origin_user_id") DO UPDATE SET
	"global_user_id" = EXCLUDED."global_user_id",
	"field_user_id" = EXCLUDED."field_user_id",
	"email" = EXCLUDED."email", "password_hash" = EXCLUDED."password_hash",
	"full_name" = EXCLUDED."full_name", "role" = EXCLUDED."role",
	"is_active" = EXCLUDED."is_active", "source_updated_at" = EXCLUDED."source_updated_at",
	"synced_at" = CURRENT_TIMESTAMP, "deleted_at" = NULL,
	"sync_version" = "unified_users"."sync_version" + 1;
--> statement-breakpoint

-- Keep historical hard-delete tombstones addressable without joining them to
-- a live person or reusing their former Field authorization subject.
INSERT INTO "global_users" (
	"id", "login_key", "field_user_id", "primary_origin_app",
	"primary_origin_user_id", "display_email", "full_name", "role",
	"is_active", "fleet_entitled", "created_at", "updated_at"
)
SELECT 'global-user:orphan:' || md5(u.id), 'orphan:' || md5(u.id),
	'global-orphan-field:' || md5(u.id), u.origin_app, u.origin_user_id,
	u.email, u.full_name, u.role, false, false,
	u.source_created_at, u.source_updated_at
FROM "unified_users" u
WHERE u.global_user_id IS NULL;
--> statement-breakpoint
UPDATE "unified_users" u
SET global_user_id = 'global-user:orphan:' || md5(u.id),
	field_user_id = 'global-orphan-field:' || md5(u.id),
	is_active = false, deleted_at = COALESCE(u.deleted_at, CURRENT_TIMESTAMP),
	synced_at = CURRENT_TIMESTAMP, sync_version = u.sync_version + 1
WHERE u.global_user_id IS NULL;
--> statement-breakpoint

ALTER TABLE "unified_users" ALTER COLUMN "global_user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "global_user_credentials" ADD CONSTRAINT
	"global_user_credentials_global_user_id_global_users_id_fk"
	FOREIGN KEY ("global_user_id") REFERENCES "public"."global_users"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "unified_users" ADD CONSTRAINT
	"unified_users_global_user_id_global_users_id_fk"
	FOREIGN KEY ("global_user_id") REFERENCES "public"."global_users"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "global_user_credentials_hash_unique"
	ON "global_user_credentials" ("global_user_id", "password_hash");
--> statement-breakpoint
CREATE INDEX "global_user_credentials_user_idx"
	ON "global_user_credentials" ("global_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "global_users_field_user_unique"
	ON "global_users" ("field_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "global_users_primary_origin_unique"
	ON "global_users" ("primary_origin_app", "primary_origin_user_id");
--> statement-breakpoint
CREATE INDEX "global_users_login_key_idx" ON "global_users" ("login_key");
--> statement-breakpoint
CREATE INDEX "global_users_role_active_idx"
	ON "global_users" ("role", "is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX "unified_users_global_app_unique"
	ON "unified_users" ("global_user_id", "origin_app");
--> statement-breakpoint
CREATE INDEX "unified_users_field_user_idx"
	ON "unified_users" ("field_user_id");
--> statement-breakpoint

-- One outer trigger invocation owns the whole global mutation. Writes it makes
-- to sibling product rows enter at depth 2 and return immediately; this avoids
-- recursion and ensures an intentional admin downgrade is not re-upgraded by a
-- sibling's stale OLD record.
CREATE OR REPLACE FUNCTION "sync_legacy_user_to_unified_users"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	application_name text := TG_ARGV[0];
	identity_id text;
	identity_login_key text;
	canonical_field_id text;
	eco_user_id text;
	solar_user_id text;
	field_user_id text;
	canonical_password_hash text;
	canonical_full_name text;
	canonical_role text;
	canonical_is_active boolean;
	canonical_created_at timestamp;
	canonical_updated_at timestamp;
	candidate_count integer;
	password_changed boolean := false;
	email_changed boolean := false;
	security_changed boolean := false;
BEGIN
	IF pg_trigger_depth() > 1 THEN
		RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	END IF;

	IF TG_OP = 'DELETE' THEN
		SELECT u.global_user_id INTO identity_id
		FROM "public"."unified_users" u
		WHERE u.origin_app = application_name AND u.origin_user_id = OLD.id;
		IF identity_id IS NULL THEN RETURN OLD; END IF;
		PERFORM pg_advisory_xact_lock(hashtext(identity_id));

		SELECT
			max(origin_user_id) FILTER (WHERE origin_app = 'ecoaudit'),
			max(origin_user_id) FILTER (WHERE origin_app = 'solarsense'),
			max(origin_user_id) FILTER (WHERE origin_app = 'installhub')
		INTO eco_user_id, solar_user_id, field_user_id
		FROM "public"."unified_users"
		WHERE global_user_id = identity_id;

		UPDATE "public"."global_users"
		SET is_active = false, updated_at = CURRENT_TIMESTAMP
		WHERE id = identity_id;
		UPDATE "public"."ea_users" SET is_active = false, updated_at = CURRENT_TIMESTAMP
		WHERE id = eco_user_id;
		UPDATE "public"."ss_users" SET is_active = false, updated_at = CURRENT_TIMESTAMP
		WHERE id = solar_user_id;
		UPDATE "public"."ih_users" SET is_active = false, updated_at = CURRENT_TIMESTAMP
		WHERE id = field_user_id;
		UPDATE "public"."unified_users"
		SET is_active = false, synced_at = CURRENT_TIMESTAMP,
			deleted_at = CASE
				WHEN origin_app = application_name AND origin_user_id = OLD.id
				THEN CURRENT_TIMESTAMP ELSE deleted_at END,
			sync_version = sync_version + 1
		WHERE global_user_id = identity_id;
		UPDATE "public"."refresh_tokens" SET revoked_at = CURRENT_TIMESTAMP
		WHERE revoked_at IS NULL AND (
			(app = 'ecoaudit' AND user_id = eco_user_id)
			OR (app = 'solarsense' AND user_id = solar_user_id)
			OR (app = 'installhub' AND user_id = field_user_id)
		);
		RETURN OLD;
	END IF;

	IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
		RAISE EXCEPTION 'User IDs are immutable authorization subjects'
			USING ERRCODE = '23514';
	END IF;

	identity_login_key := "public"."global_identity_login_key"(NEW.email);
	IF TG_OP = 'INSERT' THEN
		PERFORM pg_advisory_xact_lock(hashtext('global-login:' || identity_login_key));
		SELECT count(*)::integer, min(id)
		INTO candidate_count, identity_id
		FROM "public"."global_users"
		WHERE login_key = identity_login_key;

		IF candidate_count > 1 THEN
			RAISE EXCEPTION 'Ambiguous global login key: %', identity_login_key
				USING ERRCODE = '23505';
		END IF;
		IF candidate_count = 1 AND EXISTS (
			SELECT 1 FROM "public"."unified_users"
			WHERE global_user_id = identity_id AND origin_app = application_name
		) THEN
			RAISE EXCEPTION 'Global identity already has a % projection', application_name
				USING ERRCODE = '23505';
		END IF;

		IF candidate_count = 0 THEN
			identity_id := 'global-user:' || application_name || ':' || NEW.id;
			canonical_field_id := CASE WHEN application_name = 'installhub'
				THEN NEW.id ELSE 'unified-field:' || application_name || ':' || NEW.id END;
			INSERT INTO "public"."global_users" (
				id, login_key, field_user_id, primary_origin_app,
				primary_origin_user_id, display_email, full_name, role,
				is_active, fleet_entitled, created_at, updated_at
			) VALUES (
				identity_id, identity_login_key, canonical_field_id,
				application_name, NEW.id, NEW.email, NEW.full_name, NEW.role,
				NEW.is_active, false, NEW.created_at, NEW.updated_at
			);
			INSERT INTO "public"."global_user_credentials" (
				id, global_user_id, password_hash, created_at
			) VALUES (
				'global-credential:' || md5(identity_id || ':' || NEW.password_hash),
				identity_id, NEW.password_hash, CURRENT_TIMESTAMP
			);
		ELSE
			UPDATE "public"."global_users"
			SET role = CASE WHEN role = 'admin' OR NEW.role = 'admin'
				THEN 'admin' ELSE 'inspector' END,
				is_active = is_active AND NEW.is_active,
				full_name = COALESCE(full_name, NEW.full_name),
				updated_at = GREATEST(updated_at, NEW.updated_at)
			WHERE id = identity_id;
		END IF;
	ELSE
		SELECT u.global_user_id INTO identity_id
		FROM "public"."unified_users" u
		WHERE u.origin_app = application_name AND u.origin_user_id = NEW.id;
		IF identity_id IS NULL THEN
			RAISE EXCEPTION 'Global identity membership is missing for %:%', application_name, NEW.id
				USING ERRCODE = '23503';
		END IF;
		PERFORM pg_advisory_xact_lock(hashtext(identity_id));
		password_changed := OLD.password_hash IS DISTINCT FROM NEW.password_hash;
		email_changed := OLD.email IS DISTINCT FROM NEW.email;
		security_changed := password_changed
			OR OLD.role IS DISTINCT FROM NEW.role
			OR OLD.is_active IS DISTINCT FROM NEW.is_active;

		IF email_changed AND EXISTS (
			SELECT 1 FROM "public"."global_users"
			WHERE login_key = identity_login_key AND id <> identity_id
		) THEN
			RAISE EXCEPTION 'Global login key already exists: %', identity_login_key
				USING ERRCODE = '23505';
		END IF;
		UPDATE "public"."global_users"
		SET login_key = CASE WHEN email_changed THEN identity_login_key ELSE login_key END,
			display_email = CASE WHEN email_changed THEN NEW.email ELSE display_email END,
			full_name = NEW.full_name, role = NEW.role, is_active = NEW.is_active,
			updated_at = NEW.updated_at
		WHERE id = identity_id;
		IF password_changed THEN
			DELETE FROM "public"."global_user_credentials"
			WHERE global_user_id = identity_id;
			INSERT INTO "public"."global_user_credentials" (
				id, global_user_id, password_hash, created_at
			) VALUES (
				'global-credential:' || md5(identity_id || ':' || NEW.password_hash),
				identity_id, NEW.password_hash, CURRENT_TIMESTAMP
			);
		END IF;
	END IF;

	SELECT g.field_user_id, g.login_key, g.full_name, g.role, g.is_active,
		g.created_at, g.updated_at
	INTO canonical_field_id, identity_login_key, canonical_full_name,
		canonical_role, canonical_is_active, canonical_created_at, canonical_updated_at
	FROM "public"."global_users" g WHERE g.id = identity_id;
	SELECT password_hash INTO canonical_password_hash
	FROM "public"."global_user_credentials"
	WHERE global_user_id = identity_id ORDER BY created_at, id LIMIT 1;

	SELECT
		max(origin_user_id) FILTER (WHERE origin_app = 'ecoaudit'),
		max(origin_user_id) FILTER (WHERE origin_app = 'solarsense'),
		max(origin_user_id) FILTER (WHERE origin_app = 'installhub')
	INTO eco_user_id, solar_user_id, field_user_id
	FROM "public"."unified_users" WHERE global_user_id = identity_id;
	IF application_name = 'ecoaudit' THEN eco_user_id := NEW.id; END IF;
	IF application_name = 'solarsense' THEN solar_user_id := NEW.id; END IF;
	IF application_name = 'installhub' THEN field_user_id := NEW.id; END IF;
	eco_user_id := COALESCE(eco_user_id,
		'global-projection:ecoaudit:' || substr(md5(identity_id), 1, 32));
	solar_user_id := COALESCE(solar_user_id,
		'global-projection:solarsense:' || substr(md5(identity_id), 1, 32));
	field_user_id := COALESCE(field_user_id, canonical_field_id);
	IF field_user_id IS DISTINCT FROM canonical_field_id THEN
		RAISE EXCEPTION 'Field projection ID must equal the canonical Field subject'
			USING ERRCODE = '23514';
	END IF;

	INSERT INTO "public"."ea_users" (
		id, email, password_hash, full_name, role, is_active, created_at, updated_at
	) VALUES (
		eco_user_id, "public"."global_identity_projection_email"(
			identity_login_key, 'ecoaudit', identity_id
		), canonical_password_hash, canonical_full_name, canonical_role,
		canonical_is_active, canonical_created_at, canonical_updated_at
	) ON CONFLICT (id) DO UPDATE SET
		email = CASE WHEN email_changed THEN EXCLUDED.email ELSE "ea_users".email END,
		password_hash = CASE WHEN password_changed THEN EXCLUDED.password_hash ELSE "ea_users".password_hash END,
		full_name = EXCLUDED.full_name, role = EXCLUDED.role,
		is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;
	INSERT INTO "public"."ss_users" (
		id, email, password_hash, full_name, role, is_active, created_at, updated_at
	) VALUES (
		solar_user_id, "public"."global_identity_projection_email"(
			identity_login_key, 'solarsense', identity_id
		), canonical_password_hash, canonical_full_name, canonical_role,
		canonical_is_active, canonical_created_at, canonical_updated_at
	) ON CONFLICT (id) DO UPDATE SET
		email = CASE WHEN email_changed THEN EXCLUDED.email ELSE "ss_users".email END,
		password_hash = CASE WHEN password_changed THEN EXCLUDED.password_hash ELSE "ss_users".password_hash END,
		full_name = EXCLUDED.full_name, role = EXCLUDED.role,
		is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;
	INSERT INTO "public"."ih_users" (
		id, email, password_hash, full_name, role, is_active, created_at, updated_at
	) VALUES (
		field_user_id, "public"."global_identity_projection_email"(
			identity_login_key, 'installhub', identity_id
		), canonical_password_hash, canonical_full_name, canonical_role,
		canonical_is_active, canonical_created_at, canonical_updated_at
	) ON CONFLICT (id) DO UPDATE SET
		email = CASE WHEN email_changed THEN EXCLUDED.email ELSE "ih_users".email END,
		password_hash = CASE WHEN password_changed THEN EXCLUDED.password_hash ELSE "ih_users".password_hash END,
		full_name = EXCLUDED.full_name, role = EXCLUDED.role,
		is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;

	INSERT INTO "public"."unified_users" (
		id, global_user_id, origin_app, origin_user_id, field_user_id,
		email, password_hash, full_name, role, is_active, source_created_at,
		source_updated_at, synced_at, deleted_at, sync_version
	)
	SELECT 'unified-user:ecoaudit:' || u.id, identity_id, 'ecoaudit', u.id,
		canonical_field_id, u.email, u.password_hash, u.full_name, u.role,
		u.is_active, u.created_at, u.updated_at, CURRENT_TIMESTAMP, NULL, 1
	FROM "public"."ea_users" u WHERE u.id = eco_user_id
	ON CONFLICT (origin_app, origin_user_id) DO UPDATE SET
		global_user_id = EXCLUDED.global_user_id, field_user_id = EXCLUDED.field_user_id,
		email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
		full_name = EXCLUDED.full_name, role = EXCLUDED.role,
		is_active = EXCLUDED.is_active, source_updated_at = EXCLUDED.source_updated_at,
		synced_at = CURRENT_TIMESTAMP, deleted_at = NULL,
		sync_version = "unified_users".sync_version + 1;
	INSERT INTO "public"."unified_users" (
		id, global_user_id, origin_app, origin_user_id, field_user_id,
		email, password_hash, full_name, role, is_active, source_created_at,
		source_updated_at, synced_at, deleted_at, sync_version
	)
	SELECT 'unified-user:solarsense:' || u.id, identity_id, 'solarsense', u.id,
		canonical_field_id, u.email, u.password_hash, u.full_name, u.role,
		u.is_active, u.created_at, u.updated_at, CURRENT_TIMESTAMP, NULL, 1
	FROM "public"."ss_users" u WHERE u.id = solar_user_id
	ON CONFLICT (origin_app, origin_user_id) DO UPDATE SET
		global_user_id = EXCLUDED.global_user_id, field_user_id = EXCLUDED.field_user_id,
		email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
		full_name = EXCLUDED.full_name, role = EXCLUDED.role,
		is_active = EXCLUDED.is_active, source_updated_at = EXCLUDED.source_updated_at,
		synced_at = CURRENT_TIMESTAMP, deleted_at = NULL,
		sync_version = "unified_users".sync_version + 1;
	INSERT INTO "public"."unified_users" (
		id, global_user_id, origin_app, origin_user_id, field_user_id,
		email, password_hash, full_name, role, is_active, source_created_at,
		source_updated_at, synced_at, deleted_at, sync_version
	)
	SELECT 'unified-user:installhub:' || u.id, identity_id, 'installhub', u.id,
		canonical_field_id, u.email, u.password_hash, u.full_name, u.role,
		u.is_active, u.created_at, u.updated_at, CURRENT_TIMESTAMP, NULL, 1
	FROM "public"."ih_users" u WHERE u.id = field_user_id
	ON CONFLICT (origin_app, origin_user_id) DO UPDATE SET
		global_user_id = EXCLUDED.global_user_id, field_user_id = EXCLUDED.field_user_id,
		email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
		full_name = EXCLUDED.full_name, role = EXCLUDED.role,
		is_active = EXCLUDED.is_active, source_updated_at = EXCLUDED.source_updated_at,
		synced_at = CURRENT_TIMESTAMP, deleted_at = NULL,
		sync_version = "unified_users".sync_version + 1;

	IF security_changed THEN
		UPDATE "public"."refresh_tokens" SET revoked_at = CURRENT_TIMESTAMP
		WHERE revoked_at IS NULL AND (
			(app = 'ecoaudit' AND user_id = eco_user_id)
			OR (app = 'solarsense' AND user_id = solar_user_id)
			OR (app = 'installhub' AND user_id = field_user_id)
		);
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "lock_global_user_mutations"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	-- BEFORE STATEMENT runs before PostgreSQL takes any target row lock. One
	-- shared transaction lock gives all three product writers a fixed ordering;
	-- sibling writes from the row trigger reacquire it in the same transaction.
	PERFORM pg_advisory_xact_lock(hashtext('global-user-mutations'));
	RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "ea_users_lock_global_user_mutations"
	BEFORE INSERT OR UPDATE OR DELETE ON "ea_users"
	FOR EACH STATEMENT EXECUTE FUNCTION "lock_global_user_mutations"();
--> statement-breakpoint
CREATE TRIGGER "ss_users_lock_global_user_mutations"
	BEFORE INSERT OR UPDATE OR DELETE ON "ss_users"
	FOR EACH STATEMENT EXECUTE FUNCTION "lock_global_user_mutations"();
--> statement-breakpoint
CREATE TRIGGER "ih_users_lock_global_user_mutations"
	BEFORE INSERT OR UPDATE OR DELETE ON "ih_users"
	FOR EACH STATEMENT EXECUTE FUNCTION "lock_global_user_mutations"();
--> statement-breakpoint
CREATE TRIGGER "ea_users_sync_unified_users"
	AFTER INSERT OR UPDATE OR DELETE ON "ea_users"
	FOR EACH ROW EXECUTE FUNCTION "sync_legacy_user_to_unified_users"('ecoaudit');
--> statement-breakpoint
CREATE TRIGGER "ss_users_sync_unified_users"
	AFTER INSERT OR UPDATE OR DELETE ON "ss_users"
	FOR EACH ROW EXECUTE FUNCTION "sync_legacy_user_to_unified_users"('solarsense');
--> statement-breakpoint
CREATE TRIGGER "ih_users_sync_unified_users"
	AFTER INSERT OR UPDATE OR DELETE ON "ih_users"
	FOR EACH ROW EXECUTE FUNCTION "sync_legacy_user_to_unified_users"('installhub');
