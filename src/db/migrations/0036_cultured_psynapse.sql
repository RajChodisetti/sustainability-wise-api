ALTER TABLE "pdf_jobs" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "pdf_jobs" ADD COLUMN "claim_expires_at" timestamp;