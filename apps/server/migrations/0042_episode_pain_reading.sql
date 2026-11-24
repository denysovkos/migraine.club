CREATE TABLE "episode_pain_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"intensity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_pain_reading" ADD CONSTRAINT "episode_pain_reading_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_pain_reading_episode_id_recorded_at_idx" ON "episode_pain_reading" USING btree ("episode_id","recorded_at");--> statement-breakpoint
CREATE INDEX "episode_pain_reading_user_id_idx" ON "episode_pain_reading" USING btree ("user_id");