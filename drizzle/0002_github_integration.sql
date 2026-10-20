CREATE TYPE "public"."github_pr_state" AS ENUM('open', 'draft', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."github_ref_kind" AS ENUM('branch', 'pr', 'commit');--> statement-breakpoint
CREATE TABLE "github_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"kind" "github_ref_kind" NOT NULL,
	"number" integer,
	"sha" text,
	"ref_name" text,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"state" "github_pr_state",
	"author_login" text,
	"merged_at" timestamp with time zone,
	"github_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_refs_kind_columns" CHECK (("github_refs"."kind" = 'pr' AND "github_refs"."number" IS NOT NULL AND "github_refs"."state" IS NOT NULL)
        OR ("github_refs"."kind" = 'commit' AND "github_refs"."sha" IS NOT NULL AND "github_refs"."state" IS NULL)
        OR ("github_refs"."kind" = 'branch' AND "github_refs"."ref_name" IS NOT NULL AND "github_refs"."state" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "github_refs" ADD CONSTRAINT "github_refs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_deliveries_received_idx" ON "github_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "github_refs_issue_idx" ON "github_refs" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_refs_pr_unique" ON "github_refs" USING btree ("issue_id","repo","kind","number") WHERE "github_refs"."kind" = 'pr';--> statement-breakpoint
CREATE UNIQUE INDEX "github_refs_commit_unique" ON "github_refs" USING btree ("issue_id","repo","kind","sha") WHERE "github_refs"."kind" = 'commit';--> statement-breakpoint
CREATE UNIQUE INDEX "github_refs_branch_unique" ON "github_refs" USING btree ("issue_id","repo","kind","ref_name") WHERE "github_refs"."kind" = 'branch';--> statement-breakpoint
CREATE INDEX "github_refs_pr_idx" ON "github_refs" USING btree ("repo","number") WHERE "github_refs"."kind" = 'pr';--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_login_unique" ON "users" USING btree (lower("github_login")) WHERE "users"."github_login" IS NOT NULL;