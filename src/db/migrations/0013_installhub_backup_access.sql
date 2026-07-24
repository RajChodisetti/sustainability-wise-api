ALTER TABLE "ih_installations" ADD COLUMN "assigned_inspector_user_id" text;
--> statement-breakpoint
CREATE INDEX "ih_installations_assignee_idx" ON "ih_installations" USING btree ("assigned_inspector_user_id","updated_at");
