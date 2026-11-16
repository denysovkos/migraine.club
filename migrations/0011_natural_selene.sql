CREATE TABLE IF NOT EXISTS "doctor_verification_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"full_name" text NOT NULL,
	"country" text NOT NULL,
	"specialty" text NOT NULL,
	"verification_method" text NOT NULL,
	"license_number" text,
	"clinic_email" text,
	"applicant_statement_accepted" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp,
	"reviewed_at" timestamp,
	"reviewed_by_admin_id" text,
	"admin_notes" text,
	"user_facing_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doctor_verification_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"relative_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_verification_application_user_id_idx" ON "doctor_verification_application" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_verification_application_status_idx" ON "doctor_verification_application" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_verification_application_submitted_at_idx" ON "doctor_verification_application" USING btree ("submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_verification_file_application_id_uidx" ON "doctor_verification_file" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_verification_file_created_at_idx" ON "doctor_verification_file" USING btree ("created_at");