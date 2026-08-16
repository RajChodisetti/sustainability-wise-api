CREATE TABLE "ea_audit_work_sessions" (
	"id" text NOT NULL,
	"audit_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"last_active_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"active_milliseconds" bigint NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ea_audit_work_sessions_pk" PRIMARY KEY("audit_id","id"),
	CONSTRAINT "ea_audit_work_sessions_active_milliseconds_check" CHECK ("ea_audit_work_sessions"."active_milliseconds" >= 0),
	CONSTRAINT "ea_audit_work_sessions_revision_check" CHECK ("ea_audit_work_sessions"."revision" >= 0),
	CONSTRAINT "ea_audit_work_sessions_time_order_check" CHECK ("ea_audit_work_sessions"."started_at" <= "ea_audit_work_sessions"."last_active_at"
      AND ("ea_audit_work_sessions"."ended_at" IS NULL OR "ea_audit_work_sessions"."last_active_at" <= "ea_audit_work_sessions"."ended_at"))
);
--> statement-breakpoint
CREATE TABLE "ih_installation_work_sessions" (
	"id" text NOT NULL,
	"installation_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"last_active_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"active_milliseconds" bigint NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ih_installation_work_sessions_pk" PRIMARY KEY("installation_id","id"),
	CONSTRAINT "ih_installation_work_sessions_active_milliseconds_check" CHECK ("ih_installation_work_sessions"."active_milliseconds" >= 0),
	CONSTRAINT "ih_installation_work_sessions_revision_check" CHECK ("ih_installation_work_sessions"."revision" >= 0),
	CONSTRAINT "ih_installation_work_sessions_time_order_check" CHECK ("ih_installation_work_sessions"."started_at" <= "ih_installation_work_sessions"."last_active_at"
      AND ("ih_installation_work_sessions"."ended_at" IS NULL OR "ih_installation_work_sessions"."last_active_at" <= "ih_installation_work_sessions"."ended_at"))
);
--> statement-breakpoint
CREATE TABLE "ss_assessment_work_sessions" (
	"id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"last_active_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"active_milliseconds" bigint NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ss_assessment_work_sessions_pk" PRIMARY KEY("assessment_id","id"),
	CONSTRAINT "ss_assessment_work_sessions_active_milliseconds_check" CHECK ("ss_assessment_work_sessions"."active_milliseconds" >= 0),
	CONSTRAINT "ss_assessment_work_sessions_revision_check" CHECK ("ss_assessment_work_sessions"."revision" >= 0),
	CONSTRAINT "ss_assessment_work_sessions_time_order_check" CHECK ("ss_assessment_work_sessions"."started_at" <= "ss_assessment_work_sessions"."last_active_at"
      AND ("ss_assessment_work_sessions"."ended_at" IS NULL OR "ss_assessment_work_sessions"."last_active_at" <= "ss_assessment_work_sessions"."ended_at"))
);
--> statement-breakpoint
ALTER TABLE "ea_audit_work_sessions" ADD CONSTRAINT "ea_audit_work_sessions_audit_id_ea_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ea_audits"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ih_installation_work_sessions" ADD CONSTRAINT "ih_installation_work_sessions_installation_id_ih_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."ih_installations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ss_assessment_work_sessions" ADD CONSTRAINT "ss_assessment_work_sessions_assessment_id_ss_rooftop_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."ss_rooftop_assessments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ea_audit_work_sessions_audit_actor_idx" ON "ea_audit_work_sessions" USING btree ("audit_id","actor_user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "ih_installation_work_sessions_installation_actor_idx" ON "ih_installation_work_sessions" USING btree ("installation_id","actor_user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "ss_assessment_work_sessions_assessment_actor_idx" ON "ss_assessment_work_sessions" USING btree ("assessment_id","actor_user_id","updated_at");
