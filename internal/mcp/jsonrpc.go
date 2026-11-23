package mcp

import (
	"math"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// Values here are what jsx.ParseJSON returns: *jsx.JSONObject, []any,
// float64, string, bool and nil.

// Protocol constants of @modelcontextprotocol/core.
const (
	latestProtocolVersion  = "2025-11-25"
	firstModernVersion     = "2026-07-28"
	protocolVersionMetaKey = "io.modelcontextprotocol/protocolVersion"
	clientInfoMetaKey      = "io.modelcontextprotocol/clientInfo"
	clientCapsMetaKey      = "io.modelcontextprotocol/clientCapabilities"
	serverInfoMetaKey      = "io.modelcontextprotocol/serverInfo"
	logLevelMetaKey        = "io.modelcontextprotocol/logLevel"
	relatedTaskMetaKey     = "io.modelcontextprotocol/related-task"
	subscriptionIDMetaKey  = "io.modelcontextprotocol/subscriptionId"

	codeParseError         = -32700
	codeInvalidRequest     = -32600
	codeMethodNotFound     = -32601
	codeInvalidParams      = -32602
	codeInternalError      = -32603
	codeHeaderMismatch     = -32020
	codeUnsupportedVersion = -32022
	codeMissingClientCap   = -32021
)

// supportedProtocolVersions is SUPPORTED_PROTOCOL_VERSIONS, the legacy
// initialize list.
var supportedProtocolVersions = []string{latestProtocolVersion, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"}

// supportedModernVersions is SUPPORTED_MODERN_PROTOCOL_VERSIONS.
var supportedModernVersions = []string{firstModernVersion}

func isModernVersion(v string) bool { return v >= firstModernVersion }

func obj(v any) (*jsx.JSONObject, bool) {
	o, ok := v.(*jsx.JSONObject)
	return o, ok
}

func get(o *jsx.JSONObject, k string) (any, bool) {
	if o == nil {
		return nil, false
	}
	return o.Get(k)
}

func onlyKeys(o *jsx.JSONObject, allowed ...string) bool {
	for _, k := range o.Keys() {
		ok := false
		for _, a := range allowed {
			if k == a {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func isSafeInt(v any) bool {
	f, ok := v.(float64)
	return ok && f == math.Trunc(f) && math.Abs(f) <= 9007199254740991
}

// isRequestID is RequestIdSchema: a string or a safe integer.
func isRequestID(v any) bool {
	if _, ok := v.(string); ok {
		return true
	}
	return isSafeInt(v)
}

// validRequestMeta is RequestMetaSchema (loose): progressToken a string or
// integer, the related-task key an object with a string taskId.
func validRequestMeta(v any) bool {
	m, ok := obj(v)
	if !ok {
		return false
	}
	if t, ok := m.Get("progressToken"); ok && !isRequestID(t) {
		return false
	}
	if t, ok := m.Get(relatedTaskMetaKey); ok {
		to, ok := obj(t)
		if !ok {
			return false
		}
		id, ok := to.Get("taskId")
		if _, isStr := id.(string); !ok || !isStr {
			return false
		}
	}
	return true
}

// validParams is BaseRequestParamsSchema.loose().optional() for a present
// params key.
func validParams(v any) bool {
	p, ok := obj(v)
	if !ok {
		return false
	}
	if m, ok := p.Get("_meta"); ok && !validRequestMeta(m) {
		return false
	}
	return true
}

func jsonrpcOK(o *jsx.JSONObject) bool {
	v, ok := o.Get("jsonrpc")
	return ok && v == "2.0"
}

// isRequest is isJSONRPCRequest.
func isRequest(v any) bool {
	o, ok := obj(v)
	if !ok || !onlyKeys(o, "jsonrpc", "id", "method", "params") || !jsonrpcOK(o) {
		return false
	}
	if id, ok := o.Get("id"); !ok || !isRequestID(id) {
		return false
	}
	if m, ok := o.Get("method"); !ok {
		return false
	} else if _, isStr := m.(string); !isStr {
		return false
	}
	if p, ok := o.Get("params"); ok && !validParams(p) {
		return false
	}
	return true
}

// isNotification is isJSONRPCNotification.
func isNotification(v any) bool {
	o, ok := obj(v)
	if !ok || !onlyKeys(o, "jsonrpc", "method", "params") || !jsonrpcOK(o) {
		return false
	}
	if m, ok := o.Get("method"); !ok {
		return false
	} else if _, isStr := m.(string); !isStr {
		return false
	}
	if p, ok := o.Get("params"); ok && !validParams(p) {
		return false
	}
	return true
}

// isResultResponse is isJSONRPCResultResponse.
func isResultResponse(v any) bool {
	o, ok := obj(v)
	if !ok || !onlyKeys(o, "jsonrpc", "id", "result") || !jsonrpcOK(o) {
		return false
	}
	if id, ok := o.Get("id"); !ok || !isRequestID(id) {
		return false
	}
	r, ok := o.Get("result")
	ro, isObj := obj(r)
	if !ok || !isObj {
		return false
	}
	if m, ok := ro.Get("_meta"); ok {
		if _, isObj := obj(m); !isObj {
			return false
		}
	}
	return true
}

// isErrorResponse is isJSONRPCErrorResponse.
func isErrorResponse(v any) bool {
	o, ok := obj(v)
	if !ok || !onlyKeys(o, "jsonrpc", "id", "error") || !jsonrpcOK(o) {
		return false
	}
	if id, ok := o.Get("id"); ok && !isRequestID(id) {
		return false
	}
	e, ok := o.Get("error")
	eo, isObj := obj(e)
	if !ok || !isObj {
		return false
	}
	if c, ok := eo.Get("code"); !ok || !isSafeInt(c) {
		return false
	}
	if m, ok := eo.Get("message"); !ok {
		return false
	} else if _, isStr := m.(string); !isStr {
		return false
	}
	return true
}

func isMessage(v any) bool {
	return isRequest(v) || isNotification(v) || isResultResponse(v) || isErrorResponse(v)
}

func methodOf(o *jsx.JSONObject) string {
	m, _ := get(o, "method")
	s, _ := m.(string)
	return s
}

func paramsOf(o *jsx.JSONObject) *jsx.JSONObject {
	p, _ := get(o, "params")
	po, _ := obj(p)
	return po
}

// requestMetaOf is requestMetaOf: params._meta when both are plain objects.
func requestMetaOf(params any) *jsx.JSONObject {
	p, ok := obj(params)
	if !ok {
		return nil
	}
	m, _ := p.Get("_meta")
	mo, _ := obj(m)
	return mo
}

// hasEnvelopeClaim: the protocol-version key is present in params._meta.
func hasEnvelopeClaim(params any) bool {
	m := requestMetaOf(params)
	if m == nil {
		return false
	}
	_, ok := m.Get(protocolVersionMetaKey)
	return ok
}

// envelopeClaimVersion is the claimed version when it is a string.
func envelopeClaimVersion(params any) (string, bool) {
	m := requestMetaOf(params)
	v, _ := get(m, protocolVersionMetaKey)
	s, ok := v.(string)
	return s, ok
}

// echoableID is echoableRequestId: the id of a single request-shaped body.
func echoableID(body any) any {
	o, ok := obj(body)
	if !ok {
		return nil
	}
	if _, isStr := mustGet(o, "method").(string); !isStr {
		return nil
	}
	switch id := mustGet(o, "id").(type) {
	case string, float64:
		return id
	}
	return nil
}

func mustGet(o *jsx.JSONObject, k string) any {
	v, _ := get(o, k)
	return v
}

// errorBody is the JSON-RPC error envelope jsonRpcErrorResponse wrote:
// {jsonrpc, error: {code, message, data?}, id}.
func errorBody(code int, message string, data any, id any) *jsx.JSONObject {
	e := jsx.NewJSONObject().Set("code", float64(code)).Set("message", message)
	if data != nil {
		e.Set("data", data)
	}
	return jsx.NewJSONObject().Set("jsonrpc", "2.0").Set("error", e).Set("id", id)
}

// errorMessage is the error response Protocol sent for a request:
// {jsonrpc, id, error}.
func errorMessage(id any, code int, message string, data any) *jsx.JSONObject {
	e := jsx.NewJSONObject().Set("code", float64(code)).Set("message", message)
	if data != nil {
		e.Set("data", data)
	}
	return jsx.NewJSONObject().Set("jsonrpc", "2.0").Set("id", id).Set("error", e)
}

// resultMessage is {result, jsonrpc, id}.
func resultMessage(id any, result any) *jsx.JSONObject {
	return jsx.NewJSONObject().Set("result", result).Set("jsonrpc", "2.0").Set("id", id)
}
