CREATE TABLE IF NOT EXISTS "community_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"parent_comment_id" uuid,
	"body" text NOT NULL,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text NOT NULL,
	"episode_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags" text,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"is_from_episode" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "community_handle" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_doctor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_doctor_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_comment_post_id_idx" ON "community_comment" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_comment_parent_id_idx" ON "community_comment" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_post_author_id_idx" ON "community_post" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_post_created_at_idx" ON "community_post" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_post_score_created_at_idx" ON "community_post" USING btree ("score","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_post_id_idx" ON "community_report" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_comment_id_idx" ON "community_report" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_reporter_id_idx" ON "community_report" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_vote_post_id_idx" ON "community_vote" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_vote_post_user_unique_idx" ON "community_vote" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_community_handle_idx" ON "user" USING btree ("community_handle");