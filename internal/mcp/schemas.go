package mcp

import (
	"github.com/denysovkos/migraine.club/internal/jsx"
	z "github.com/denysovkos/migraine.club/internal/zod"
)

// plain converts a jsx value into the tree internal/zod reads.
func plain(v any) any {
	switch x := v.(type) {
	case *jsx.JSONObject:
		m := make(map[string]any, x.Len())
		for _, k := range x.Keys() {
			val, _ := x.Get(k)
			m[k] = plain(val)
		}
		return m
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = plain(e)
		}
		return out
	}
	return v
}

// The wire schemas of @modelcontextprotocol/core (2025 era) and of the
// frozen 2026-07-28 build. Both eras share these shapes for the methods this
// server answers.
var (
	jsonObject    = z.Record(z.String(), z.Unknown())
	progressToken = z.Union(z.String(), z.Number().Int())
	requestMeta   = z.Object(
		z.F("progressToken", z.Optional(progressToken)),
		z.F(relatedTaskMetaKey, z.Optional(z.Object(z.F("taskId", z.String())))),
	).Loose()
	baseParams = z.Object(z.F("_meta", z.Optional(requestMeta)))

	icon = z.Object(
		z.F("src", z.String()),
		z.F("mimeType", z.Optional(z.String())),
		z.F("sizes", z.Optional(z.Array(z.String()))),
		z.F("theme", z.Optional(z.Enum("light", "dark"))),
	)
	implementation = z.Object(
		z.F("name", z.String()),
		z.F("title", z.Optional(z.String())),
		z.F("icons", z.Optional(z.Array(icon))),
		z.F("version", z.String()),
		z.F("websiteUrl", z.Optional(z.String())),
		z.F("description", z.Optional(z.String())),
	)

	formElicitation = z.Intersection(z.Object(z.F("applyDefaults", z.Optional(z.Boolean()))), jsonObject)
	elicitationCap  = z.Preprocess(func(v any) any {
		if m, ok := v.(map[string]any); ok && len(m) == 0 {
			return map[string]any{"form": map[string]any{}}
		}
		return v
	}, z.Intersection(z.Object(
		z.F("form", z.Optional(formElicitation)),
		z.F("url", z.Optional(jsonObject)),
	), z.Optional(jsonObject)))
	clientTasksCap = z.Object(
		z.F("list", z.Optional(jsonObject)),
		z.F("cancel", z.Optional(jsonObject)),
		z.F("requests", z.Optional(z.Object(
			z.F("sampling", z.Optional(z.Object(z.F("createMessage", z.Optional(jsonObject))).Loose())),
			z.F("elicitation", z.Optional(z.Object(z.F("create", z.Optional(jsonObject))).Loose())),
		).Loose())),
	).Loose()
	clientCapsFields = []z.Field{
		z.F("experimental", z.Optional(z.Record(z.String(), jsonObject))),
		z.F("sampling", z.Optional(z.Object(
			z.F("context", z.Optional(jsonObject)),
			z.F("tools", z.Optional(jsonObject)),
		))),
		z.F("elicitation", z.Optional(elicitationCap)),
		z.F("roots", z.Optional(z.Object(z.F("listChanged", z.Optional(z.Boolean()))))),
	}
	clientCaps2025 = z.Object(append(append([]z.Field{}, clientCapsFields...),
		z.F("tasks", z.Optional(clientTasksCap)),
		z.F("extensions", z.Optional(z.Record(z.String(), jsonObject))),
	)...)
	clientCaps2026 = z.Object(append(append([]z.Field{}, clientCapsFields...),
		z.F("extensions", z.Optional(z.Record(z.String(), jsonObject))),
	)...)

	loggingLevel = z.Enum("debug", "info", "notice", "warning", "error", "critical", "alert", "emergency")

	// envelopeSchema is RequestMetaEnvelopeSchema.
	envelopeSchema = z.Object(
		z.F("progressToken", z.Optional(progressToken)),
		z.F(protocolVersionMetaKey, z.String()),
		z.F(clientInfoMetaKey, z.Optional(implementation)),
		z.F(clientCapsMetaKey, clientCaps2026),
		z.F(logLevelMetaKey, z.Optional(loggingLevel)),
	).Loose()

	// request builds RequestSchema.extend({method: literal, params}).
	initializeRequest = z.Object(
		z.F("method", z.Literal("initialize")),
		z.F("params", baseParams.Extend(
			z.F("protocolVersion", z.String()),
			z.F("capabilities", clientCaps2025),
			z.F("clientInfo", implementation),
		)),
	)
	pingRequest = z.Object(
		z.F("method", z.Literal("ping")),
		z.F("params", z.Optional(baseParams.Loose())),
	)
	paginatedParams  = baseParams.Extend(z.F("cursor", z.Optional(z.String())))
	listToolsRequest = z.Object(
		z.F("method", z.Literal("tools/list")),
		z.F("params", z.Optional(paginatedParams)),
	)
	taskMetadata    = z.Object(z.F("ttl", z.Optional(z.Number())))
	callToolRequest = z.Object(
		z.F("method", z.Literal("tools/call")),
		z.F("params", baseParams.Extend(
			z.F("task", z.Optional(taskMetadata)),
			z.F("name", z.String()),
			z.F("arguments", z.Optional(z.Record(z.String(), z.Unknown()))),
		)),
	)
)

// issuesError is String(zodError): the issues as two-space indented JSON.
func issuesError(err error) string { return err.Error() }

// envelopeIssue is one validateEnvelopeMeta entry.
type envelopeIssue struct{ Key, Problem string }

// validateEnvelopeMeta is the 2026 codec's validateEnvelopeMeta.
func validateEnvelopeMeta(meta *jsx.JSONObject) []envelopeIssue {
	var issues []envelopeIssue
	for _, key := range []string{protocolVersionMetaKey, clientCapsMetaKey} {
		if _, ok := meta.Get(key); !ok {
			issues = append(issues, envelopeIssue{key, "missing"})
		}
	}
	_, err := z.Parse(envelopeSchema, plain(meta))
	if err == nil {
		return issues
	}
	for _, is := range err.(*z.Error).Issues {
		parts := make([]string, len(is.Path()))
		for i, p := range is.Path() {
			parts[i] = pathString(p)
		}
		key := "_meta"
		if len(parts) > 0 {
			key = join(parts, ".")
		}
		if len(parts) == 1 && hasMissing(issues, key) {
			continue
		}
		issues = append(issues, envelopeIssue{key, is.Message()})
	}
	return issues
}

func hasMissing(issues []envelopeIssue, key string) bool {
	for _, e := range issues {
		if e.Key == key && e.Problem == "missing" {
			return true
		}
	}
	return false
}

func pathString(p any) string {
	switch x := p.(type) {
	case string:
		return x
	case float64:
		return jsx.FormatNumber(x)
	case int:
		return jsx.FormatNumber(float64(x))
	}
	return ""
}

func join(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}
