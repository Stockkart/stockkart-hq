ALTER TABLE "projects" ADD COLUMN "board_issue_types" "issue_type"[];--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "board_hidden_status_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "list_issue_types" "issue_type"[];--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "list_hidden_status_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_board_issue_types_size" CHECK (cardinality("projects"."board_issue_types") BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_board_hidden_status_ids_size" CHECK (cardinality("projects"."board_hidden_status_ids") <= 20);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_list_issue_types_size" CHECK (cardinality("projects"."list_issue_types") BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_list_hidden_status_ids_size" CHECK (cardinality("projects"."list_hidden_status_ids") <= 20);