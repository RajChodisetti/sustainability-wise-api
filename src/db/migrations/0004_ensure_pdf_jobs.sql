CREATE TABLE IF NOT EXISTS "pdf_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "app" text NOT NULL,
  "entity_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "user_id" text NOT NULL,
  "params" jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "phase" text,
  "progress_current" integer,
  "progress_total" integer,
  "pdf_url" text,
  "storage_key" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

