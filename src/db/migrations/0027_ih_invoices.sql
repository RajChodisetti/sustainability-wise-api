CREATE TABLE IF NOT EXISTS "ih_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"issue_date" timestamp,
	"due_date" timestamp,
	"subtotal_ex_gst" real DEFAULT 0 NOT NULL,
	"gst_amount" real DEFAULT 0 NOT NULL,
	"total_inc_gst" real DEFAULT 0 NOT NULL,
	"gst_rate" real DEFAULT 0.1 NOT NULL,
	"notes" text,
	"seller_name" text,
	"seller_abn" text,
	"seller_address" text,
	"seller_email" text,
	"created_by_user_id" text,
	"issued_at" timestamp,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_invoices_status_check" CHECK ("status" IN ('draft', 'issued', 'void'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ih_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"unit_amount_ex_gst" real DEFAULT 0 NOT NULL,
	"line_total_ex_gst" real DEFAULT 0 NOT NULL,
	"cost_line_id" text,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_invoice_lines_category_check" CHECK ("category" IS NULL OR "category" IN ('labour', 'material', 'other'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ih_invoices" ADD CONSTRAINT "ih_invoices_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."ih_installations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ih_invoice_lines" ADD CONSTRAINT "ih_invoice_lines_invoice_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."ih_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ih_invoice_lines" ADD CONSTRAINT "ih_invoice_lines_cost_line_fk" FOREIGN KEY ("cost_line_id") REFERENCES "public"."ih_job_cost_lines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ih_invoices_number_unique" ON "ih_invoices" USING btree ("invoice_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ih_invoices_installation_idx" ON "ih_invoices" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ih_invoices_installation_status_idx" ON "ih_invoices" USING btree ("installation_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ih_invoice_lines_invoice_idx" ON "ih_invoice_lines" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ih_invoice_lines_cost_line_idx" ON "ih_invoice_lines" USING btree ("cost_line_id");
