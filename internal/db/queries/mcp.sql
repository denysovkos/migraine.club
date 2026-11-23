-- name: InsertMcpToolCallAudit :exec
INSERT INTO mcp_tool_call_audit (user_id, tool_name, client_id, outcome, error_code, duration_ms)
VALUES (@user_id, @tool_name, sqlc.narg(client_id), @outcome, sqlc.narg(error_code), sqlc.narg(duration_ms));
