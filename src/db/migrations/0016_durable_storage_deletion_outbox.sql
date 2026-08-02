CREATE TABLE "storage_deletion_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"app" text NOT NULL,
	"storage_key" text NOT NULL,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_deletion_tasks_storage_key_unique" ON "storage_deletion_tasks" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "storage_deletion_tasks_app_created_idx" ON "storage_deletion_tasks" USING btree ("app","created_at");
