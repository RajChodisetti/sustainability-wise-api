CREATE TABLE IF NOT EXISTS "ih_job_finance" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"pricing_mode" text DEFAULT 'charge_up' NOT NULL,
	"priced_amount" real,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"notes" text,
	"updated_by_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_job_finance_pricing_mode_check" CHECK ("pricing_mode" IN ('quoted', 'charge_up'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ih_job_cost_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"cost_amount" real DEFAULT 0 NOT NULL,
	"sell_amount" real,
	"hours" real,
	"billable" boolean DEFAULT true NOT NULL,
	"invoiced" boolean DEFAULT false NOT NULL,
	"incurred_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_job_cost_lines_category_check" CHECK ("category" IN ('labour', 'material', 'other'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ih_job_finance" ADD CONSTRAINT "ih_job_finance_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."ih_installations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ih_job_cost_lines" ADD CONSTRAINT "ih_job_cost_lines_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."ih_installations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ih_job_cost_lines_installation_idx" ON "ih_job_cost_lines" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ih_job_cost_lines_installation_invoiced_idx" ON "ih_job_cost_lines" USING btree ("installation_id","invoiced");
