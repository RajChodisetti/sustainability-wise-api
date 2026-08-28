CREATE TABLE "scheduler_job_actor_billing_rate_overrides" (
	"finance_id" text NOT NULL,
	"global_user_id" text NOT NULL,
	"billing_rate_cents" bigint NOT NULL,
	"updated_by_global_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_job_actor_billing_rate_overrides_pk" PRIMARY KEY("finance_id","global_user_id"),
	CONSTRAINT "scheduler_job_actor_billing_rate_overrides_rate_check" CHECK (
      "scheduler_job_actor_billing_rate_overrides"."billing_rate_cents" >= 0
      AND "scheduler_job_actor_billing_rate_overrides"."billing_rate_cents" <= 9007199254740991
    )
);
--> statement-breakpoint
ALTER TABLE "scheduler_job_actor_billing_rate_overrides" ADD CONSTRAINT "scheduler_job_actor_billing_rate_overrides_finance_id_scheduler_job_finance_id_fk" FOREIGN KEY ("finance_id") REFERENCES "public"."scheduler_job_finance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_job_actor_billing_rate_overrides" ADD CONSTRAINT "scheduler_job_actor_billing_rate_overrides_global_user_id_global_users_id_fk" FOREIGN KEY ("global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_job_actor_billing_rate_overrides" ADD CONSTRAINT "scheduler_job_actor_billing_rate_overrides_updated_by_global_user_id_global_users_id_fk" FOREIGN KEY ("updated_by_global_user_id") REFERENCES "public"."global_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduler_job_actor_billing_rate_overrides_user_idx" ON "scheduler_job_actor_billing_rate_overrides" USING btree ("global_user_id");