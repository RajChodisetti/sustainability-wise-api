CREATE TABLE "ea_audit_edit_lease_events" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"fence" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"client_instance_id" text NOT NULL,
	"client_kind" text NOT NULL,
	"previous_owner_user_id" text,
	"previous_client_instance_id" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ea_audit_edit_lease_events_fence_check" CHECK ("ea_audit_edit_lease_events"."fence" > 0),
	CONSTRAINT "ea_audit_edit_lease_events_type_check" CHECK (
    "ea_audit_edit_lease_events"."event_type" IN ('acquired', 'reissued', 'released', 'taken_over', 'completed')
  ),
	CONSTRAINT "ea_audit_edit_lease_events_client_kind_check" CHECK (
    "ea_audit_edit_lease_events"."client_kind" IN ('mobile', 'portal')
  )
);
--> statement-breakpoint
CREATE TABLE "ea_audit_edit_leases" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"fence" integer NOT NULL,
	"owner_user_id" text NOT NULL,
	"client_instance_id" text NOT NULL,
	"client_kind" text NOT NULL,
	"client_label" text,
	"token_hash" text NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "ea_audit_edit_leases_fence_check" CHECK ("ea_audit_edit_leases"."fence" > 0),
	CONSTRAINT "ea_audit_edit_leases_client_kind_check" CHECK (
    "ea_audit_edit_leases"."client_kind" IN ('mobile', 'portal')
  )
);
--> statement-breakpoint
CREATE TABLE "ea_audit_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"operation" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"client_instance_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"base_tree_revision" integer NOT NULL,
	"resulting_tree_revision" integer NOT NULL,
	"record_version_number" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ea_audit_idempotency_revision_check" CHECK (
    "ea_audit_idempotency"."base_tree_revision" >= 0
    AND "ea_audit_idempotency"."resulting_tree_revision" >= 0
    AND "ea_audit_idempotency"."record_version_number" >= 0
  )
);
--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "tree_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "record_version_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "edit_fence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "copied_from_audit_id" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "copied_from_record_version_number" integer;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "lineage_root_audit_id" text;--> statement-breakpoint
ALTER TABLE "ea_audits" ADD COLUMN "copy_purpose" text;--> statement-breakpoint
ALTER TABLE "ea_audit_edit_lease_events" ADD CONSTRAINT "ea_audit_edit_lease_events_audit_id_ea_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ea_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_audit_edit_leases" ADD CONSTRAINT "ea_audit_edit_leases_audit_id_ea_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ea_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_audit_idempotency" ADD CONSTRAINT "ea_audit_idempotency_audit_id_ea_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ea_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ea_audit_edit_lease_events_audit_idx" ON "ea_audit_edit_lease_events" USING btree ("audit_id","created_at");--> statement-breakpoint
CREATE INDEX "ea_audit_edit_leases_owner_idx" ON "ea_audit_edit_leases" USING btree ("owner_user_id","client_instance_id");--> statement-breakpoint
CREATE INDEX "ea_audit_edit_leases_expiry_idx" ON "ea_audit_edit_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ea_audit_idempotency_scope_unique" ON "ea_audit_idempotency" USING btree ("audit_id","operation","actor_user_id","client_instance_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ea_audit_idempotency_audit_idx" ON "ea_audit_idempotency" USING btree ("audit_id","created_at");--> statement-breakpoint
CREATE INDEX "ea_audits_copied_from_idx" ON "ea_audits" USING btree ("copied_from_audit_id");--> statement-breakpoint
CREATE INDEX "ea_audits_lineage_root_idx" ON "ea_audits" USING btree ("lineage_root_audit_id","updated_at");--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_tree_revision_check" CHECK ("ea_audits"."tree_revision" >= 0);--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_record_version_check" CHECK ("ea_audits"."record_version_number" >= 0);--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_edit_fence_check" CHECK ("ea_audits"."edit_fence" >= 0);--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_copy_purpose_check" CHECK (
    "ea_audits"."copy_purpose" IS NULL OR "ea_audits"."copy_purpose" IN ('independent', 'amendment')
  );--> statement-breakpoint
ALTER TABLE "ea_audits" ADD CONSTRAINT "ea_audits_copy_provenance_check" CHECK (
    ("ea_audits"."copied_from_audit_id" IS NULL
      AND "ea_audits"."copied_from_record_version_number" IS NULL
      AND "ea_audits"."copy_purpose" IS NULL)
    OR ("ea_audits"."copied_from_audit_id" IS NOT NULL
      AND "ea_audits"."copied_from_record_version_number" IS NOT NULL
      AND "ea_audits"."copied_from_record_version_number" >= 1
      AND "ea_audits"."copy_purpose" IS NOT NULL)
  );
