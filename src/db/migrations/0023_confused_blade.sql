ALTER TABLE "ih_installations" ADD COLUMN "electrical_map_layout" jsonb;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "electrical_map_layout_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD COLUMN "electrical_map_layout_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_electrical_map_layout_revision_check" CHECK ("ih_installations"."electrical_map_layout_revision" >= 0);