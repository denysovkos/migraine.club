CREATE TABLE IF NOT EXISTS "doctor_share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"recipient_name" text,
	"patient_display_name" text,
	"expires_at" timestamp NOT NULL,
	"date_range_start" timestamp,
	"date_range_end" timestamp,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_share_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_share_link_token_idx" ON "doctor_share_link" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_share_link_user_id_idx" ON "doctor_share_link" USING btree ("user_id");