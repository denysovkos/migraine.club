CREATE TABLE "cron_run_lock" (
	"job_name" text PRIMARY KEY NOT NULL,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"run_id" text NOT NULL
);
