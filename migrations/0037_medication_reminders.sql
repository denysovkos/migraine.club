CREATE TABLE "preventive_reminder_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"time_slot" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preventive_plan" ADD COLUMN "reminder_times" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "preventive_plan" ADD COLUMN "reminders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preventive_reminder_log" ADD CONSTRAINT "preventive_reminder_log_plan_id_preventive_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."preventive_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preventive_reminder_log_plan_date_slot_uidx" ON "preventive_reminder_log" USING btree ("plan_id","local_date","time_slot");--> statement-breakpoint
CREATE INDEX "preventive_reminder_log_user_date_idx" ON "preventive_reminder_log" USING btree ("user_id","local_date");