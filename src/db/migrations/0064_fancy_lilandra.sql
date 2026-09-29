CREATE TABLE "ea_audit_purge_tombstones" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"purged_by_user_id" text NOT NULL,
	"last_tree_revision" integer NOT NULL,
	"last_edit_fence" integer NOT NULL,
	"purged_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ea_audit_purge_tombstones_revision_check" CHECK (
    "ea_audit_purge_tombstones"."last_tree_revision" >= 0 AND "ea_audit_purge_tombstones"."last_edit_fence" >= 0
  )
);
--> statement-breakpoint
ALTER TABLE "ea_audit_edit_lease_events" DROP CONSTRAINT "ea_audit_edit_lease_events_audit_id_ea_audits_id_fk";
--> statement-breakpoint
CREATE INDEX "ea_audit_purge_tombstones_purged_at_idx" ON "ea_audit_purge_tombstones" USING btree ("purged_at");