CREATE TABLE IF NOT EXISTS "user_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"consent_type" text NOT NULL,
	"version" text DEFAULT '1.0' NOT NULL,
	"given_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_consent_user_type_idx" ON "user_consent" USING btree ("user_id","consent_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_consent_user_id_idx" ON "user_consent" USING btree ("user_id");