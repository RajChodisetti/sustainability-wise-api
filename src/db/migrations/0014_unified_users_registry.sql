-- Expand-only shared user registry. Eco Audit, Solar Sense, and InstallHub keep
-- their existing tables and API contracts; one-way triggers mirror every
-- legacy account here for additive portal and Field access support.
CREATE TABLE IF NOT EXISTS "unified_users" (
	"id" text PRIMARY KEY NOT NULL,
	"origin_app" text NOT NULL,
	"origin_user_id" text NOT NULL,
	"field_user_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source_created_at" timestamp NOT NULL,
	"source_updated_at" timestamp NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"sync_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "unified_users_origin_app_check"
		CHECK ("origin_app" IN ('ecoaudit', 'solarsense', 'installhub')),
	CONSTRAINT "unified_users_sync_version_check"
		CHECK ("sync_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unified_users_origin_unique"
	ON "unified_users" USING btree ("origin_app", "origin_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unified_users_field_user_unique"
	ON "unified_users" USING btree ("field_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unified_users_email_idx"
	ON "unified_users" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unified_users_app_role_active_idx"
	ON "unified_users" USING btree ("origin_app", "role", "is_active");
--> statement-breakpoint

-- Drizzle runs every pending PostgreSQL migration statement in one
-- transaction. Block only legacy user-table writers until the backfill and
-- triggers below are both complete, so an installed app cannot commit a user
-- change in the gap and leave the additive registry stale. Normal reads remain
-- available while this migration runs.
LOCK TABLE "ea_users", "ss_users", "ih_users"
	IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- A native Field ID must never overlap a synthetic source subject. Fail with a
-- diagnostic before writing any shared rows instead of silently attributing
-- one person's installation data to another account.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ih_users" AS field_user
		JOIN (
			SELECT
				'unified-field:ecoaudit:' || "id" AS "field_user_id"
			FROM "ea_users"
			UNION ALL
			SELECT
				'unified-field:solarsense:' || "id" AS "field_user_id"
			FROM "ss_users"
		) AS source_user
			ON source_user."field_user_id" = field_user."id"
	) THEN
		RAISE EXCEPTION
			'Cannot create unified users: a native Field user ID collides with a source Field subject'
			USING ERRCODE = '23505';
	END IF;
END
$$;
--> statement-breakpoint

INSERT INTO "unified_users" (
	"id",
	"origin_app",
	"origin_user_id",
	"field_user_id",
	"email",
	"password_hash",
	"full_name",
	"role",
	"is_active",
	"source_created_at",
	"source_updated_at",
	"synced_at",
	"deleted_at",
	"sync_version"
)
SELECT
	'unified-user:' || source_user."origin_app" || ':' || source_user."id",
	source_user."origin_app",
	source_user."id",
	CASE
		WHEN source_user."origin_app" = 'installhub'
			THEN source_user."id"
		ELSE 'unified-field:' || source_user."origin_app" || ':' || source_user."id"
	END,
	source_user."email",
	source_user."password_hash",
	source_user."full_name",
	source_user."role",
	source_user."is_active",
	source_user."created_at",
	source_user."updated_at",
	CURRENT_TIMESTAMP,
	NULL,
	1
FROM (
	SELECT
		'ecoaudit'::text AS "origin_app",
		"id",
		"email",
		"password_hash",
		"full_name",
		"role",
		"is_active",
		"created_at",
		"updated_at"
	FROM "ea_users"
	UNION ALL
	SELECT
		'solarsense'::text AS "origin_app",
		"id",
		"email",
		"password_hash",
		"full_name",
		"role",
		"is_active",
		"created_at",
		"updated_at"
	FROM "ss_users"
	UNION ALL
	SELECT
		'installhub'::text AS "origin_app",
		"id",
		"email",
		"password_hash",
		"full_name",
		"role",
		"is_active",
		"created_at",
		"updated_at"
	FROM "ih_users"
) AS source_user
ON CONFLICT ("origin_app", "origin_user_id") DO UPDATE
SET
	"field_user_id" = EXCLUDED."field_user_id",
	"email" = EXCLUDED."email",
	"password_hash" = EXCLUDED."password_hash",
	"full_name" = EXCLUDED."full_name",
	"role" = EXCLUDED."role",
	"is_active" = EXCLUDED."is_active",
	"source_created_at" = LEAST(
		"unified_users"."source_created_at",
		EXCLUDED."source_created_at"
	),
	"source_updated_at" = EXCLUDED."source_updated_at",
	"synced_at" = CURRENT_TIMESTAMP,
	"deleted_at" = NULL,
	"sync_version" = "unified_users"."sync_version" + 1;
--> statement-breakpoint

-- All three legacy user tables share these columns, so one trigger function can
-- safely mirror them without referencing app-specific record fields.
CREATE OR REPLACE FUNCTION "sync_legacy_user_to_unified_users"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	application_name text := TG_ARGV[0];
	field_subject_id text;
	previous_field_subject_id text;
	should_revoke boolean := false;
BEGIN
	IF TG_OP = 'DELETE' THEN
		field_subject_id := CASE
			WHEN application_name = 'installhub' THEN OLD."id"
			ELSE 'unified-field:' || application_name || ':' || OLD."id"
		END;

		UPDATE "public"."unified_users"
		SET
			"email" = OLD."email",
			"password_hash" = OLD."password_hash",
			"full_name" = OLD."full_name",
			"role" = OLD."role",
			"is_active" = false,
			"source_updated_at" = OLD."updated_at",
			"synced_at" = CURRENT_TIMESTAMP,
			"deleted_at" = CURRENT_TIMESTAMP,
			"sync_version" = "sync_version" + 1
		WHERE "origin_app" = application_name
			AND "origin_user_id" = OLD."id";

		UPDATE "public"."refresh_tokens"
		SET "revoked_at" = CURRENT_TIMESTAMP
		WHERE "revoked_at" IS NULL
			AND (
				("app" = 'installhub' AND "user_id" = field_subject_id)
				OR ("app" = application_name AND "user_id" = OLD."id")
			);

		RETURN OLD;
	END IF;

	IF TG_OP = 'UPDATE' AND OLD."id" IS DISTINCT FROM NEW."id" THEN
		RAISE EXCEPTION
			'User IDs are immutable authorization subjects'
			USING ERRCODE = '23514';
	END IF;

	field_subject_id := CASE
		WHEN application_name = 'installhub' THEN NEW."id"
		ELSE 'unified-field:' || application_name || ':' || NEW."id"
	END;
	IF TG_OP = 'UPDATE' THEN
		previous_field_subject_id := CASE
			WHEN application_name = 'installhub' THEN OLD."id"
			ELSE 'unified-field:' || application_name || ':' || OLD."id"
		END;
	ELSE
		previous_field_subject_id := field_subject_id;
	END IF;

	IF application_name <> 'installhub'
		AND EXISTS (
			SELECT 1
			FROM "public"."ih_users"
			WHERE "id" = field_subject_id
		) THEN
		RAISE EXCEPTION
			'Source Field subject collides with a native Field user ID: %',
			field_subject_id
			USING ERRCODE = '23505';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "public"."unified_users"
		WHERE "field_user_id" = field_subject_id
			AND (
				"origin_app" <> application_name
				OR "origin_user_id" <> NEW."id"
			)
	) THEN
		RAISE EXCEPTION
			'Field subject is already assigned to another unified user: %',
			field_subject_id
			USING ERRCODE = '23505';
	END IF;

	IF TG_OP = 'UPDATE' THEN
		should_revoke :=
			OLD."password_hash" IS DISTINCT FROM NEW."password_hash"
			OR OLD."role" IS DISTINCT FROM NEW."role"
			OR OLD."is_active" IS DISTINCT FROM NEW."is_active"
			OR OLD."id" IS DISTINCT FROM NEW."id";
	END IF;

	INSERT INTO "public"."unified_users" (
		"id",
		"origin_app",
		"origin_user_id",
		"field_user_id",
		"email",
		"password_hash",
		"full_name",
		"role",
		"is_active",
		"source_created_at",
		"source_updated_at",
		"synced_at",
		"deleted_at",
		"sync_version"
	)
	VALUES (
		'unified-user:' || application_name || ':' || NEW."id",
		application_name,
		NEW."id",
		field_subject_id,
		NEW."email",
		NEW."password_hash",
		NEW."full_name",
		NEW."role",
		NEW."is_active",
		NEW."created_at",
		NEW."updated_at",
		CURRENT_TIMESTAMP,
		NULL,
		1
	)
	ON CONFLICT ("origin_app", "origin_user_id") DO UPDATE
	SET
		"field_user_id" = EXCLUDED."field_user_id",
		"email" = EXCLUDED."email",
		"password_hash" = EXCLUDED."password_hash",
		"full_name" = EXCLUDED."full_name",
		"role" = EXCLUDED."role",
		"is_active" = EXCLUDED."is_active",
		"source_created_at" = LEAST(
			"public"."unified_users"."source_created_at",
			EXCLUDED."source_created_at"
		),
		"source_updated_at" = EXCLUDED."source_updated_at",
		"synced_at" = CURRENT_TIMESTAMP,
		"deleted_at" = NULL,
		"sync_version" = "public"."unified_users"."sync_version" + 1;

	IF should_revoke THEN
		UPDATE "public"."refresh_tokens"
		SET "revoked_at" = CURRENT_TIMESTAMP
		WHERE "revoked_at" IS NULL
			AND (
				(
					"app" = 'installhub'
					AND "user_id" IN (
						field_subject_id,
						previous_field_subject_id
					)
				)
				OR (
					"app" = application_name
					AND "user_id" IN (NEW."id", OLD."id")
				)
			);
	END IF;

	RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ea_users_sync_unified_users" ON "ea_users";
--> statement-breakpoint
CREATE TRIGGER "ea_users_sync_unified_users"
	AFTER INSERT OR UPDATE OR DELETE ON "ea_users"
	FOR EACH ROW
	EXECUTE FUNCTION "sync_legacy_user_to_unified_users"('ecoaudit');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ss_users_sync_unified_users" ON "ss_users";
--> statement-breakpoint
CREATE TRIGGER "ss_users_sync_unified_users"
	AFTER INSERT OR UPDATE OR DELETE ON "ss_users"
	FOR EACH ROW
	EXECUTE FUNCTION "sync_legacy_user_to_unified_users"('solarsense');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ih_users_sync_unified_users" ON "ih_users";
--> statement-breakpoint
CREATE TRIGGER "ih_users_sync_unified_users"
	AFTER INSERT OR UPDATE OR DELETE ON "ih_users"
	FOR EACH ROW
	EXECUTE FUNCTION "sync_legacy_user_to_unified_users"('installhub');
