CREATE TABLE "idempotent_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"route" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotent_request_user_key_idx" ON "idempotent_request" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotent_request_created_idx" ON "idempotent_request" USING btree ("created_at");