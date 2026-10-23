CREATE TYPE "public"."handbook_publication_state" AS ENUM('open', 'merged', 'closed', 'failed');--> statement-breakpoint
CREATE TABLE "handbook_publication_docs" (
	"publication_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"path" text NOT NULL,
	"doc_version" integer NOT NULL,
	"blob_sha" text,
	"open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handbook_publication_docs_publication_id_doc_id_pk" PRIMARY KEY("publication_id","doc_id"),
	CONSTRAINT "handbook_publication_docs_path_format" CHECK (("handbook_publication_docs"."path" ~ '^([A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*[.]md$'
    AND char_length("handbook_publication_docs"."path") <= 200
    AND strpos("handbook_publication_docs"."path", '..') = 0)),
	CONSTRAINT "handbook_publication_docs_version_positive" CHECK ("handbook_publication_docs"."doc_version" > 0),
	CONSTRAINT "handbook_publication_docs_blob_sha_format" CHECK ("handbook_publication_docs"."blob_sha" IS NULL OR "handbook_publication_docs"."blob_sha" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "handbook_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"branch" text NOT NULL,
	"pr_number" integer,
	"pr_url" text,
	"state" "handbook_publication_state" DEFAULT 'open' NOT NULL,
	"is_open" boolean GENERATED ALWAYS AS (state = 'open') STORED NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "handbook_publications_id_open_unique" UNIQUE("id","is_open"),
	CONSTRAINT "handbook_publications_branch_format" CHECK ("handbook_publications"."branch" ~ '^hq/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$'
        AND strpos("handbook_publications"."branch", '..') = 0 AND "handbook_publications"."branch" NOT LIKE '%.lock'),
	CONSTRAINT "handbook_publications_pr_number_positive" CHECK ("handbook_publications"."pr_number" IS NULL OR "handbook_publications"."pr_number" > 0),
	CONSTRAINT "handbook_publications_pr_url_format" CHECK ("handbook_publications"."pr_url" IS NULL OR "handbook_publications"."pr_url" ~ '^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]{0,9}$'),
	CONSTRAINT "handbook_publications_pr_together" CHECK (("handbook_publications"."pr_number" IS NULL) = ("handbook_publications"."pr_url" IS NULL)),
	CONSTRAINT "handbook_publications_merged_at_state" CHECK (("handbook_publications"."state" = 'merged') = ("handbook_publications"."merged_at" IS NOT NULL)),
	CONSTRAINT "handbook_publications_merged_has_pr" CHECK ("handbook_publications"."state" NOT IN ('merged', 'closed') OR "handbook_publications"."pr_number" IS NOT NULL),
	CONSTRAINT "handbook_publications_error_code" CHECK ("handbook_publications"."error_code" IS NULL OR ("handbook_publications"."state" = 'failed'
        AND "handbook_publications"."error_code" ~ '^[a-z0-9_.-]{1,64}$'))
);
--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "handbook_path" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "handbook_blob_sha" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "handbook_synced_version" integer;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "handbook_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "handbook_remote_sha" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "handbook_remote_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handbook_publication_docs" ADD CONSTRAINT "handbook_publication_docs_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_publication_docs" ADD CONSTRAINT "handbook_publication_docs_publication_open_fk" FOREIGN KEY ("publication_id","open") REFERENCES "public"."handbook_publications"("id","is_open") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "handbook_publications" ADD CONSTRAINT "handbook_publications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_publications" ADD CONSTRAINT "handbook_publications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handbook_publication_docs_one_open_per_doc" ON "handbook_publication_docs" USING btree ("doc_id") WHERE "handbook_publication_docs"."open";--> statement-breakpoint
CREATE INDEX "handbook_publication_docs_doc_idx" ON "handbook_publication_docs" USING btree ("doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handbook_publication_docs_publication_path_unique" ON "handbook_publication_docs" USING btree ("publication_id",lower("path"));--> statement-breakpoint
CREATE UNIQUE INDEX "handbook_publications_project_branch_unique" ON "handbook_publications" USING btree ("project_id","branch");--> statement-breakpoint
CREATE UNIQUE INDEX "handbook_publications_project_pr_unique" ON "handbook_publications" USING btree ("project_id","pr_number") WHERE "handbook_publications"."pr_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "handbook_publications_project_created_idx" ON "handbook_publications" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "docs_project_handbook_file_unique" ON "docs" USING btree ("project_id",lower(coalesce("handbook_path", "source_path"))) WHERE "docs"."deleted_at" IS NULL AND coalesce("docs"."handbook_path", "docs"."source_path") IS NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_handbook_path_format" CHECK ("docs"."handbook_path" IS NULL OR ("docs"."handbook_path" ~ '^([A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*[.]md$'
    AND char_length("docs"."handbook_path") <= 200
    AND strpos("docs"."handbook_path", '..') = 0));--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_handbook_blob_sha_format" CHECK ("docs"."handbook_blob_sha" IS NULL OR "docs"."handbook_blob_sha" ~ '^[0-9a-f]{40}$');--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_handbook_remote_sha_format" CHECK ("docs"."handbook_remote_sha" IS NULL OR "docs"."handbook_remote_sha" ~ '^[0-9a-f]{40}$');--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_handbook_synced_together" CHECK (("docs"."handbook_blob_sha" IS NULL) = ("docs"."handbook_synced_version" IS NULL)
        AND ("docs"."handbook_blob_sha" IS NULL) = ("docs"."handbook_synced_at" IS NULL));--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_handbook_synced_version_valid" CHECK ("docs"."handbook_synced_version" IS NULL OR "docs"."handbook_synced_version" BETWEEN 1 AND "docs"."version");--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_handbook_remote_sha_seen" CHECK ("docs"."handbook_remote_sha" IS NULL OR "docs"."handbook_remote_seen_at" IS NOT NULL);