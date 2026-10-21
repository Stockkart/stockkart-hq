CREATE TYPE "public"."attachment_entity_type" AS ENUM('issue', 'comment', 'doc');--> statement-breakpoint
CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TYPE "public"."diagram_kind" AS ENUM('whiteboard', 'flow');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('assigned', 'mentioned', 'comment_on_watched', 'status_on_watched', 'mentioned_in_doc');--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'attachment';--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "attachment_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_by" uuid,
	"status" "attachment_status" DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "attachments_size_range" CHECK ("attachments"."size_bytes" BETWEEN 1 AND 10485760),
	CONSTRAINT "attachments_dimensions_positive" CHECK (("attachments"."width" IS NULL OR "attachments"."width" > 0) AND ("attachments"."height" IS NULL OR "attachments"."height" > 0))
);
--> statement-breakpoint
CREATE TABLE "diagram_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagram_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"scene" jsonb NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_versions_scene_size" CHECK (octet_length("diagram_versions"."scene"::text) < 2097152)
);
--> statement-breakpoint
CREATE TABLE "diagrams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "diagram_kind" NOT NULL,
	"title" text NOT NULL,
	"scene" jsonb NOT NULL,
	"scene_text" text DEFAULT '' NOT NULL,
	"thumbnail_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"owner_id" uuid,
	"updated_by" uuid,
	"template_id" uuid,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("scene_text", '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagrams_version_positive" CHECK ("diagrams"."version" > 0),
	CONSTRAINT "diagrams_scene_size" CHECK (octet_length("diagrams"."scene"::text) < 2097152)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" uuid,
	"meta" jsonb,
	"read_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchers" (
	"issue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchers_issue_id_user_id_pk" PRIMARY KEY("issue_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_versions" ADD CONSTRAINT "diagram_versions_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_versions" ADD CONSTRAINT "diagram_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchers" ADD CONSTRAINT "watchers_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchers" ADD CONSTRAINT "watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attachments_pending_created_idx" ON "attachments" USING btree ("created_at") WHERE "attachments"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "diagram_versions_diagram_version_unique" ON "diagram_versions" USING btree ("diagram_id","version");--> statement-breakpoint
CREATE INDEX "diagrams_project_position_idx" ON "diagrams" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "diagrams_search_idx" ON "diagrams" USING gin ("search");--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notifications" USING btree ("user_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_user_project_name_unique" ON "saved_views" USING btree ("user_id","project_id","name");--> statement-breakpoint
CREATE INDEX "saved_views_project_shared_idx" ON "saved_views" USING btree ("project_id") WHERE "saved_views"."shared";--> statement-breakpoint
CREATE INDEX "watchers_user_idx" ON "watchers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;