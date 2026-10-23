CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'yearly', 'usage');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('hosting', 'database', 'storage', 'email', 'ai_ocr', 'domain_dns', 'monitoring', 'source_control', 'payments', 'saas_other', 'other');--> statement-breakpoint
CREATE TYPE "public"."cost_entry_kind" AS ENUM('actual', 'estimate', 'no_charge');--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'cost_item';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'cost_reminder';--> statement-breakpoint
CREATE TABLE "cost_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"period" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"fx_rate_to_base" numeric(12, 6),
	"base_amount_minor" bigint NOT NULL,
	"kind" "cost_entry_kind" NOT NULL,
	"notes" text,
	"entered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_entries_period_first_day" CHECK (extract(day from "cost_entries"."period") = 1),
	CONSTRAINT "cost_entries_amount" CHECK ("cost_entries"."amount_minor" >= 0 AND "cost_entries"."amount_minor" <= 999999999999),
	CONSTRAINT "cost_entries_base_amount" CHECK ("cost_entries"."base_amount_minor" >= 0 AND "cost_entries"."base_amount_minor" <= 999999999999),
	CONSTRAINT "cost_entries_currency" CHECK ("cost_entries"."currency" IN ('INR', 'USD')),
	CONSTRAINT "cost_entries_fx_rate" CHECK ("cost_entries"."fx_rate_to_base" IS NULL OR "cost_entries"."fx_rate_to_base" > 0),
	CONSTRAINT "cost_entries_base_without_rate" CHECK ("cost_entries"."fx_rate_to_base" IS NOT NULL OR "cost_entries"."base_amount_minor" = "cost_entries"."amount_minor"),
	CONSTRAINT "cost_entries_no_charge_zero" CHECK ("cost_entries"."kind" <> 'no_charge' OR "cost_entries"."amount_minor" = 0)
);
--> statement-breakpoint
CREATE TABLE "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"vendor" text,
	"category" "cost_category" NOT NULL,
	"service_id" uuid,
	"billing_cycle" "billing_cycle" NOT NULL,
	"currency" text NOT NULL,
	"expected_amount_minor" bigint,
	"renews_on" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_items_name_length" CHECK (char_length("cost_items"."name") BETWEEN 1 AND 100),
	CONSTRAINT "cost_items_currency" CHECK ("cost_items"."currency" IN ('INR', 'USD')),
	CONSTRAINT "cost_items_expected_amount" CHECK ("cost_items"."expected_amount_minor" IS NULL OR ("cost_items"."expected_amount_minor" >= 0 AND "cost_items"."expected_amount_minor" <= 999999999999))
);
--> statement-breakpoint
CREATE TABLE "cost_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"base_currency" text DEFAULT 'INR' NOT NULL,
	"monthly_budget_minor" bigint,
	"reminder_day" integer DEFAULT 1 NOT NULL,
	"reminder_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"default_usd_to_inr" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_settings_project_unique" UNIQUE("project_id"),
	CONSTRAINT "cost_settings_base_currency" CHECK ("cost_settings"."base_currency" IN ('INR', 'USD')),
	CONSTRAINT "cost_settings_budget" CHECK ("cost_settings"."monthly_budget_minor" IS NULL OR ("cost_settings"."monthly_budget_minor" >= 0 AND "cost_settings"."monthly_budget_minor" <= 999999999999)),
	CONSTRAINT "cost_settings_reminder_day" CHECK ("cost_settings"."reminder_day" BETWEEN 1 AND 28),
	CONSTRAINT "cost_settings_usd_to_inr" CHECK ("cost_settings"."default_usd_to_inr" IS NULL OR "cost_settings"."default_usd_to_inr" > 0),
	CONSTRAINT "cost_settings_reminder_users" CHECK (cardinality("cost_settings"."reminder_user_ids") <= 50)
);
--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_item_id_cost_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cost_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_settings" ADD CONSTRAINT "cost_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_entries_item_period_unique" ON "cost_entries" USING btree ("item_id","period");--> statement-breakpoint
CREATE INDEX "cost_entries_period_idx" ON "cost_entries" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_items_project_name_unique" ON "cost_items" USING btree ("project_id",lower("name")) WHERE "cost_items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "cost_items_project_position_idx" ON "cost_items" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "cost_items_service_idx" ON "cost_items" USING btree ("service_id");