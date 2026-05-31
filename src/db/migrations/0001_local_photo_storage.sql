ALTER TABLE "photo_registry" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "photo_registry" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "photo_registry" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "photo_registry" ADD COLUMN "uploaded_at" timestamp;