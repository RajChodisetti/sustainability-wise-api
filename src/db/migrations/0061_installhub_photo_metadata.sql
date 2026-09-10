ALTER TABLE "ih_zones" ADD COLUMN "photo_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ih_electrical_assets" ADD COLUMN "photo_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ih_site_assets" ADD COLUMN "photo_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ih_meter_devices" ADD COLUMN "photo_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
