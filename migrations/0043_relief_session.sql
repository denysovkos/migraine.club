CREATE TABLE "relief_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" integer,
	"exercise" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"completed" boolean NOT NULL,
	"helped" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relief_session" ADD CONSTRAINT "relief_session_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relief_session_user_id_started_at_idx" ON "relief_session" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "relief_session_episode_id_idx" ON "relief_session" USING btree ("episode_id");