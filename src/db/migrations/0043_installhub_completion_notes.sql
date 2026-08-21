ALTER TABLE "ih_installations" ADD COLUMN "completion_notes" text;--> statement-breakpoint
ALTER TABLE "ih_installations" ADD CONSTRAINT "ih_installations_completion_notes_length_check" CHECK ("ih_installations"."completion_notes" IS NULL OR char_length("ih_installations"."completion_notes") <= 2000) NOT VALID;--> statement-breakpoint
ALTER TABLE "ih_installations" VALIDATE CONSTRAINT "ih_installations_completion_notes_length_check";
