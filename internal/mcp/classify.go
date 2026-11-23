package mcp

import (
	"fmt"
	"strings"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// route is one classifyInboundRequest outcome.
type route struct {
	kind string // "legacy", "modern" or "reject"

	// legacy
	reason string

	// modern
	notification bool
	message      *jsx.JSONObject
	revision     string // the claimed revision, "" when none

	// reject
	status  int
	code    int
	text    string
	data    any
	rungKey string
}

type stdHeaders struct {
	version, method, name *string
}

func headerPtr(h string, ok bool) *string {
	if !ok {
		return nil
	}
	return &h
}

// stripOWS removes leading and trailing spaces and tabs.
func stripOWS(s string) string { return strings.Trim(s, " \t") }

func (h stdHeaders) stripped() stdHeaders {
	strip := func(p *string) *string {
		if p == nil {
			return nil
		}
		v := stripOWS(*p)
		return &v
	}
	return stdHeaders{strip(h.version), strip(h.method), strip(h.name)}
}

func reject(status, code int, text string, data any) route {
	return route{kind: "reject", status: status, code: code, text: text, data: data}
}

func mismatch(header, body string) route {
	return reject(400, codeHeaderMismatch, "Bad Request: the request headers and body disagree: "+body,
		jsx.NewJSONObject().Set("mismatch", jsx.NewJSONObject().Set("header", header).Set("body", body)))
}

func envelopeIssueData(is envelopeIssue) *jsx.JSONObject {
	return jsx.NewJSONObject().Set("key", is.Key).Set("problem", is.Problem)
}

// carriesValidModernClaim is carriesValidModernEnvelopeClaim.
func carriesValidModernClaim(params any) bool {
	if !hasEnvelopeClaim(params) {
		return false
	}
	v, ok := envelopeClaimVersion(params)
	if !ok || !isModernVersion(v) {
		return false
	}
	meta := requestMetaOf(params)
	return meta != nil && len(validateEnvelopeMeta(meta)) == 0
}

func classifyBatch(body []any) route {
	if len(body) == 0 {
		return reject(400, codeInvalidRequest, "Bad Request: empty JSON-RPC batch", nil)
	}
	for _, el := range body {
		var params any
		if o, ok := obj(el); ok {
			params = mustGet(o, "params")
		}
		if hasEnvelopeClaim(params) {
			return reject(400, codeInvalidRequest, "Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later", nil)
		}
		if !isMessage(el) {
			return reject(400, codeInvalidRequest, "Bad Request: JSON-RPC batch contains an invalid message", nil)
		}
	}
	return route{kind: "legacy", reason: "batch"}
}

func classifyRequestBody(h stdHeaders, body *jsx.JSONObject) route {
	params := mustGet(body, "params")
	method := methodOf(body)
	headerModern := h.version != nil && isModernVersion(*h.version)
	if method == "initialize" && !carriesValidModernClaim(params) {
		if headerModern {
			return mismatch(*h.version, "an initialize request (legacy handshake) was sent with a modern MCP-Protocol-Version header")
		}
		return route{kind: "legacy", reason: "initialize"}
	}
	if hasEnvelopeClaim(params) {
		meta := requestMetaOf(params)
		var issues []envelopeIssue
		if meta != nil {
			issues = validateEnvelopeMeta(meta)
		}
		if len(issues) > 0 {
			first := issues[0]
			return reject(400, codeInvalidParams, fmt.Sprintf("Invalid _meta envelope for protocol revision 2026-07-28: %s: %s", first.Key, first.Problem),
				jsx.NewJSONObject().Set("envelope", envelopeIssueData(first)))
		}
		claimed, hasClaim := envelopeClaimVersion(params)
		if h.version != nil && hasClaim && *h.version != claimed {
			return mismatch(*h.version, fmt.Sprintf("the body envelope names protocol version %s but the MCP-Protocol-Version header names %s", claimed, *h.version))
		}
		if h.method != nil && *h.method != method {
			return mismatch(*h.method, fmt.Sprintf("the body names method %s but the Mcp-Method header names %s", method, *h.method))
		}
		r := route{kind: "modern", message: body}
		if hasClaim {
			r.revision = claimed
		}
		return r
	}
	if headerModern {
		meta := requestMetaOf(params)
		var missing []any
		if meta == nil {
			missing = []any{"_meta"}
		} else {
			for _, is := range validateEnvelopeMeta(meta) {
				if is.Problem == "missing" {
					missing = append(missing, is.Key)
				}
			}
			if len(missing) == 0 {
				missing = []any{protocolVersionMetaKey}
			}
		}
		names := make([]string, len(missing))
		for i, m := range missing {
			names[i] = m.(string)
		}
		return reject(400, codeInvalidParams, fmt.Sprintf("Invalid params: the MCP-Protocol-Version header names protocol revision %s, but the request is missing the required per-request envelope key(s): %s", *h.version, strings.Join(names, ", ")),
			jsx.NewJSONObject().Set("envelope", jsx.NewJSONObject().Set("missing", missing)))
	}
	return route{kind: "legacy", reason: "no-claim"}
}

func classifyNotificationBody(h stdHeaders, body *jsx.JSONObject) route {
	params := mustGet(body, "params")
	method := methodOf(body)
	headerModern := h.version != nil && isModernVersion(*h.version)
	if hasEnvelopeClaim(params) {
		claimed, ok := envelopeClaimVersion(params)
		if !ok {
			issue := envelopeIssue{protocolVersionMetaKey, "expected a protocol version string"}
			if meta := requestMetaOf(params); meta != nil {
				for _, is := range validateEnvelopeMeta(meta) {
					if is.Key == protocolVersionMetaKey {
						issue = is
						break
					}
				}
			}
			return reject(400, codeInvalidParams, fmt.Sprintf("Invalid _meta envelope for protocol revision 2026-07-28: %s: %s", issue.Key, issue.Problem),
				jsx.NewJSONObject().Set("envelope", envelopeIssueData(issue)))
		}
		if h.version != nil && *h.version != claimed {
			return mismatch(*h.version, fmt.Sprintf("the notification envelope names protocol version %s but the MCP-Protocol-Version header names %s", claimed, *h.version))
		}
		if isModernVersion(claimed) && h.method != nil && *h.method != method {
			return mismatch(*h.method, fmt.Sprintf("the notification body names method %s but the Mcp-Method header names %s", method, *h.method))
		}
		return route{kind: "modern", notification: true, message: body, revision: claimed}
	}
	if headerModern {
		if h.method != nil && *h.method != method {
			return mismatch(*h.method, fmt.Sprintf("the notification body names method %s but the Mcp-Method header names %s", method, *h.method))
		}
		return route{kind: "modern", notification: true, message: body, revision: *h.version}
	}
	return route{kind: "legacy", reason: "notification"}
}

// classify is classifyInboundRequest for a POST with a JSON body.
func classify(h stdHeaders, body any) route {
	h = h.stripped()
	if arr, ok := body.([]any); ok {
		return classifyBatch(arr)
	}
	if isResultResponse(body) || isErrorResponse(body) {
		return route{kind: "legacy", reason: "response"}
	}
	if isRequest(body) {
		return classifyRequestBody(h, body.(*jsx.JSONObject))
	}
	if isNotification(body) {
		return classifyNotificationBody(h, body.(*jsx.JSONObject))
	}
	return reject(400, codeInvalidRequest, "Bad Request: the request body is not a valid JSON-RPC message", nil)
}
