CREATE TABLE "scheduler_annual_targets" (
	"company_key" text NOT NULL,
	"year" integer NOT NULL,
	"amount_ex_gst_cents" bigint NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"updated_by_global_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_annual_targets_company_key_year_pk" PRIMARY KEY("company_key","year"),
	CONSTRAINT "scheduler_annual_targets_company_key_check" CHECK (
    length(btrim("scheduler_annual_targets"."company_key")) BETWEEN 1 AND 100
  ),
	CONSTRAINT "scheduler_annual_targets_year_check" CHECK ("scheduler_annual_targets"."year" BETWEEN 2000 AND 9999),
	CONSTRAINT "scheduler_annual_targets_amount_check" CHECK (
    "scheduler_annual_targets"."amount_ex_gst_cents" > 0
    AND "scheduler_annual_targets"."amount_ex_gst_cents" <= 9007199254740991
  ),
	CONSTRAINT "scheduler_annual_targets_currency_check" CHECK (
    "scheduler_annual_targets"."currency" ~ '^[A-Z]{3}$'
  )
);
--> statement-breakpoint
ALTER TABLE "scheduler_annual_targets" ADD CONSTRAINT "scheduler_annual_targets_updated_by_global_user_id_global_users_id_fk" FOREIGN KEY ("updated_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE set null ON UPDATE no action;