CREATE TABLE IF NOT EXISTS "record_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "app" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "version_number" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "record_versions_entity_version_idx"
  ON "record_versions" ("app", "entity_type", "entity_id", "version_number");

CREATE INDEX IF NOT EXISTS "record_versions_entity_idx"
  ON "record_versions" ("app", "entity_type", "entity_id");
