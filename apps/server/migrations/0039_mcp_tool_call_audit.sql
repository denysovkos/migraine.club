CREATE TABLE "mcp_tool_call_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"client_id" text,
	"outcome" text NOT NULL,
	"error_code" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mcp_tool_call_audit_user_created_idx" ON "mcp_tool_call_audit" USING btree ("user_id","created_at");