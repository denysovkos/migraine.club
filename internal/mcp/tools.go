package mcp

import (
	_ "embed"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/service/episodes"
	"github.com/denysovkos/migraine.club/internal/service/factors"
	"github.com/denysovkos/migraine.club/internal/service/meds"
	z "github.com/denysovkos/migraine.club/internal/zod"
)

// toolsJSON is the Node server's tools/list result (scripts/gen-mcp-tools.mts).
//
//go:embed tools.json
var toolsJSON []byte

// Catalog is what the server advertises.
type Catalog struct {
	ServerName, ServerVersion, Instructions string
	// Tools is the tools/list array, exactly as Node listed it.
	Tools []any
	names []string
}

func loadCatalog() (*Catalog, error) {
	v, err := jsx.ParseJSON(toolsJSON)
	if err != nil {
		return nil, err
	}
	root := v.(*jsx.JSONObject)
	info := mustGet(root, "serverInfo").(*jsx.JSONObject)
	c := &Catalog{
		ServerName:    mustGet(info, "name").(string),
		ServerVersion: mustGet(info, "version").(string),
		Instructions:  mustGet(root, "instructions").(string),
		Tools:         mustGet(root, "tools").([]any),
	}
	for _, t := range c.Tools {
		c.names = append(c.names, mustGet(t.(*jsx.JSONObject), "name").(string))
	}
	return c, nil
}

// Scopes of src/server/mcp/scopes.ts.
const (
	ScopeRead  = "migraine:read"
	ScopeWrite = "migraine:write"
)

type scopeError struct{ required string }

func (e *scopeError) Error() string {
	return fmt.Sprintf("This action requires the %q scope, which this connection was not granted.", e.required)
}

// codedError is an error with a code the model can act on (the services'
// typed errors that toErrorPayload passed through).
type codedError struct{ code, message string }

func (e *codedError) Error() string { return e.message }

type toolCtx struct {
	UserID, ClientID string
	Scopes           []string
}

type toolResult struct {
	Summary string
	Data    any // nil: no payload block
}

type toolDef struct {
	name  string
	scope string
	input z.Schema // nil when the tool takes no arguments
	run   func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error)
}

// formatIssue is the SDK's formatIssue.
func formatIssue(is z.Issue) string {
	if len(is.Path()) == 0 {
		return is.Message()
	}
	parts := make([]string, len(is.Path()))
	for i, p := range is.Path() {
		parts[i] = pathString(p)
	}
	return strings.Join(parts, ".") + ": " + is.Message()
}

func textContent(text string) *jsx.JSONObject {
	return jsx.NewJSONObject().Set("content", []any{jsx.NewJSONObject().Set("type", "text").Set("text", text)})
}

// textBlock is defineTool's textBlock: the summary, then the payload as
// JSON.stringify(payload, null, 2) in a json fence.
func textBlock(summary string, payload any) *jsx.JSONObject {
	if payload == nil {
		return textContent(summary)
	}
	b, err := httpx.MarshalIndent(payload, "  ")
	if err != nil {
		b = []byte("null")
	}
	return textContent(summary + "\n\n```json\n" + string(b) + "\n```")
}

func errorResult(text string) *jsx.JSONObject {
	return textContent(text).Set("isError", true)
}

// errorPayload is toErrorPayload.
func errorPayload(err error) *httpx.Object {
	var se *scopeError
	var ee *episodes.Error
	var de *meds.DoseError
	var dy *diary.Error
	var ce *codedError
	var ze *z.Error
	switch {
	case errors.As(err, &se):
		return httpx.O("code", "INSUFFICIENT_SCOPE", "message", se.Error())
	case errors.As(err, &ee):
		o := httpx.O("code", ee.Code, "message", ee.Message)
		if ee.Details != nil {
			o.Set("details", ee.Details)
		}
		return o
	case errors.As(err, &de):
		return httpx.O("code", de.Code, "message", de.Message)
	case errors.Is(err, factors.ErrConsent):
		return httpx.O("code", "CONSENT_REQUIRED", "message", factors.ErrConsent.Error())
	case errors.As(err, &ce):
		return httpx.O("code", ce.code, "message", ce.message)
	case errors.As(err, &dy):
		o := httpx.O("code", dy.Code, "message", dy.Message)
		if dy.Details != nil {
			o.Set("details", dy.Details)
		}
		return o
	case errors.As(err, &ze):
		return httpx.O("code", "VALIDATION_ERROR", "message", "Invalid arguments", "details", ze.Issues)
	}
	return httpx.O("code", "INTERNAL_ERROR", "message", "Something went wrong handling this request.")
}

// callTool is McpServer's tools/call handler wrapped by registerTool.
func (s *Server) callTool(ctx context.Context, params map[string]any, auth *AuthInfo) (*jsx.JSONObject, *protocolError) {
	name, _ := params["name"].(string)
	def, ok := s.tools[name]
	if !ok || !slices.Contains(s.catalog.names, name) {
		return nil, &protocolError{codeInvalidParams, fmt.Sprintf("Tool %s not found", name)}
	}
	var args map[string]any
	if def.input != nil {
		raw, present := params["arguments"]
		if !present {
			raw = map[string]any{}
		}
		parsed, err := z.Parse(def.input, raw)
		if err != nil {
			parts := []string{}
			for _, is := range err.(*z.Error).Issues {
				parts = append(parts, formatIssue(is))
			}
			return errorResult(fmt.Sprintf("Input validation error: Invalid arguments for tool %s: %s", name, strings.Join(parts, ", "))), nil
		}
		args, _ = parsed.(map[string]any)
	}
	if args == nil {
		args = map[string]any{}
	}
	return s.runTool(ctx, def, args, auth), nil
}

func (s *Server) runTool(ctx context.Context, def toolDef, args map[string]any, auth *AuthInfo) *jsx.JSONObject {
	tc := toolCtx{ClientID: "unknown"}
	if auth != nil {
		tc.UserID = auth.UserID
		if auth.ClientID != "" {
			tc.ClientID = auth.ClientID
		}
		tc.Scopes = auth.Scopes
	}
	if tc.UserID == "" {
		return textBlock("Not authenticated.", httpx.O("code", "UNAUTHENTICATED")).Set("isError", true)
	}
	started := s.now()
	var res toolResult
	var err error
	if !slices.Contains(tc.Scopes, def.scope) {
		err = &scopeError{def.scope}
	} else {
		res, err = def.run(ctx, args, tc)
	}
	if err == nil {
		s.audit(ctx, tc, def.name, "ok", nil, started)
		return textBlock(res.Summary, res.Data)
	}
	payload := errorPayload(err)
	code, _ := payload.Get("code")
	codeStr, _ := code.(string)
	if codeStr == "INTERNAL_ERROR" {
		s.log.Error("MCP tool failed", "error", err, "tool", def.name, "userId", tc.UserID)
	}
	s.audit(ctx, tc, def.name, "error", &codeStr, started)
	msg, _ := payload.Get("message")
	return textBlock(msg.(string), payload).Set("isError", true)
}

// audit is recordToolCall: best effort, a failure is only logged.
func (s *Server) audit(ctx context.Context, tc toolCtx, tool, outcome string, code *string, started time.Time) {
	ms := int32(s.now().Sub(started).Milliseconds()) //nolint:gosec // a request's duration
	client := tc.ClientID
	if err := s.q.InsertMcpToolCallAudit(context.WithoutCancel(ctx), q.InsertMcpToolCallAuditParams{
		UserID: tc.UserID, ToolName: tool, ClientID: &client, Outcome: outcome, ErrorCode: code, DurationMs: &ms,
	}); err != nil {
		s.log.Warn("Failed to write MCP tool call audit row", "error", err, "toolName", tool)
	}
}

// Server answers MCP messages for one deployment.
type Server struct {
	catalog *Catalog
	tools   map[string]toolDef
	q       *q.Queries
	log     *slog.Logger
	now     func() time.Time
}
