CREATE TABLE IF NOT EXISTS "feature_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"resolution" text DEFAULT 'SENT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_request_user_id_idx" ON "feature_request" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_request_resolution_idx" ON "feature_request" USING btree ("resolution");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_request_created_at_idx" ON "feature_request" USING btree ("created_at");