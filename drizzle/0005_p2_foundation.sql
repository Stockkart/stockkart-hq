CREATE TYPE "public"."digest_frequency" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_kind" AS ENUM('digest');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('issues_csv');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('previewed', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('sev1', 'sev2', 'sev3');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('investigating', 'mitigated', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."incident_timeline_kind" AS ENUM('note', 'status_change', 'action');--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'service';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'release';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'comment_on_doc';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'incident_commander';--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "email_delivery_kind" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_id" text,
	"status" "email_delivery_status" DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_period_order" CHECK ("email_deliveries"."period_end" > "email_deliveries"."period_start"),
	CONSTRAINT "email_deliveries_sent_at_status" CHECK (("email_deliveries"."status" = 'sent') = ("email_deliveries"."sent_at" IS NOT NULL)),
	CONSTRAINT "email_deliveries_error_code" CHECK ("email_deliveries"."error_code" IS NULL OR ("email_deliveries"."status" = 'failed' AND char_length("email_deliveries"."error_code") <= 100))
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "import_kind" NOT NULL,
	"filename" text NOT NULL,
	"created_by" uuid,
	"status" "import_status" DEFAULT 'previewed' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "imports_counts_valid" CHECK ("imports"."row_count" >= 0 AND "imports"."created_count" >= 0 AND "imports"."error_count" >= 0
        AND "imports"."created_count" + "imports"."error_count" <= "imports"."row_count"),
	CONSTRAINT "imports_applied_at_status" CHECK (("imports"."status" = 'applied') = ("imports"."applied_at" IS NOT NULL)),
	CONSTRAINT "imports_filename_length" CHECK (char_length("imports"."filename") BETWEEN 1 AND 255),
	CONSTRAINT "imports_report_size" CHECK (octet_length("imports"."report"::text) < 1048576)
);
--> statement-breakpoint
CREATE TABLE "incident_services" (
	"incident_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_services_incident_id_service_id_pk" PRIMARY KEY("incident_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "incident_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" uuid,
	"kind" "incident_timeline_kind" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_timeline_body_length" CHECK (char_length("incident_timeline"."body") BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'investigating' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mitigated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"commander_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"postmortem_doc_id" uuid,
	"deleted_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("summary", '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_number_positive" CHECK ("incidents"."number" > 0),
	CONSTRAINT "incidents_title_length" CHECK (char_length("incidents"."title") BETWEEN 1 AND 200),
	CONSTRAINT "incidents_resolved_at_status" CHECK (("incidents"."status" = 'resolved') = ("incidents"."resolved_at" IS NOT NULL)),
	CONSTRAINT "incidents_mitigated_at_status" CHECK ("incidents"."status" <> 'mitigated' OR "incidents"."mitigated_at" IS NOT NULL),
	CONSTRAINT "incidents_times_ordered" CHECK (("incidents"."mitigated_at" IS NULL OR "incidents"."mitigated_at" >= "incidents"."started_at")
        AND ("incidents"."resolved_at" IS NULL
          OR "incidents"."resolved_at" >= coalesce("incidents"."mitigated_at", "incidents"."started_at")))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"repo" text,
	"runtime" text,
	"owner_id" uuid,
	"environments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_slug_format" CHECK (char_length("services"."slug") <= 64 AND "services"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "services_repo_format" CHECK ("services"."repo" IS NULL OR "services"."repo" ~ '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'),
	CONSTRAINT "services_json_arrays" CHECK (jsonb_typeof("services"."environments") = 'array' AND jsonb_typeof("services"."links") = 'array'
        AND jsonb_array_length("services"."environments") <= 50
        AND jsonb_array_length("services"."links") <= 50)
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "anchor_id" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "anchor_text" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "incident_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "auto_retro" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "retro_doc_id" uuid;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN "wip_limit" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_frequency" "digest_frequency" DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_digest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_unsubscribe_token_hash" text;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_services" ADD CONSTRAINT "incident_services_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_services" ADD CONSTRAINT "incident_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_timeline" ADD CONSTRAINT "incident_timeline_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_timeline" ADD CONSTRAINT "incident_timeline_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_commander_id_users_id_fk" FOREIGN KEY ("commander_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_postmortem_doc_id_docs_id_fk" FOREIGN KEY ("postmortem_doc_id") REFERENCES "public"."docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_user_kind_period_unique" ON "email_deliveries" USING btree ("user_id","kind","period_start");--> statement-breakpoint
CREATE INDEX "imports_project_created_idx" ON "imports" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incident_services_service_idx" ON "incident_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "incident_timeline_incident_at_idx" ON "incident_timeline" USING btree ("incident_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_project_number_unique" ON "incidents" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "incidents_project_started_idx" ON "incidents" USING btree ("project_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_search_idx" ON "incidents" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "services_project_slug_unique" ON "services" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "services_project_position_idx" ON "services" USING btree ("project_id","position");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-moved above the FK that references it (drizzle-kit emits it later).
ALTER TABLE "comments" ADD CONSTRAINT "comments_id_entity_unique" UNIQUE("id","entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_same_entity_fk" FOREIGN KEY ("parent_id","entity_type","entity_id") REFERENCES "public"."comments"("id","entity_type","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_retro_doc_id_docs_id_fk" FOREIGN KEY ("retro_doc_id") REFERENCES "public"."docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_entity_anchor_idx" ON "comments" USING btree ("entity_type","entity_id","anchor_id") WHERE "comments"."anchor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id") WHERE "comments"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "issues_release_idx" ON "issues" USING btree ("release_id") WHERE "issues"."release_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unsubscribe_token_hash_unique" ON "users" USING btree ("email_unsubscribe_token_hash") WHERE "users"."email_unsubscribe_token_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_anchor_doc_only" CHECK (("comments"."anchor_id" IS NULL AND "comments"."anchor_text" IS NULL) OR "comments"."entity_type" = 'doc');--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_anchor_format" CHECK ("comments"."anchor_id" IS NULL OR "comments"."anchor_id" ~ '^[A-Za-z0-9_-]{1,64}$');--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_anchor_text_needs_anchor" CHECK ("comments"."anchor_text" IS NULL OR ("comments"."anchor_id" IS NOT NULL AND char_length("comments"."anchor_text") <= 500));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_needs_resolved_at" CHECK ("comments"."resolved_by" IS NULL OR "comments"."resolved_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_not_own_parent" CHECK ("comments"."parent_id" IS DISTINCT FROM "comments"."id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_reply_plain" CHECK ("comments"."parent_id" IS NULL OR ("comments"."anchor_id" IS NULL AND "comments"."anchor_text" IS NULL AND "comments"."resolved_at" IS NULL));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_incident_counter_nonneg" CHECK ("projects"."incident_counter" >= 0);--> statement-breakpoint
-- Hand-added backfill: releases marked released before released_at existed. 'released' is
-- a release_state value since 0001, so it is safe to use here (not an ADD VALUE of 0005).
UPDATE "releases" SET "released_at" = coalesce("release_date"::timestamptz, "updated_at") WHERE "state" = 'released' AND "released_at" IS NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_released_at_state" CHECK (("releases"."state" = 'released') = ("releases"."released_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_wip_limit_range" CHECK ("statuses"."wip_limit" IS NULL OR "statuses"."wip_limit" BETWEEN 1 AND 999);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unsubscribe_token_hash_format" CHECK ("users"."email_unsubscribe_token_hash" IS NULL OR "users"."email_unsubscribe_token_hash" ~ '^[0-9a-f]{64}$');