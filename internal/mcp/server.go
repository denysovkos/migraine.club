package mcp

import (
	"context"
	"slices"

	"github.com/denysovkos/migraine.club/internal/jsx"
	z "github.com/denysovkos/migraine.club/internal/zod"
)

// AuthInfo is the verified token withMcpAuth put on the request.
type AuthInfo struct {
	Token    string
	ClientID string
	Scopes   []string
	// UserID is authInfo.extra.userId; empty when the verifier gave none.
	UserID string
}

// outcome is one request's response and whether it was sent inside the
// synchronous dispatch window (where the modern transport maps ladder codes
// to an HTTP status).
type outcome struct {
	msg  *jsx.JSONObject
	sync bool
}

func capabilities() *jsx.JSONObject {
	return jsx.NewJSONObject().Set("tools", jsx.NewJSONObject().Set("listChanged", true))
}

func (s *Server) serverInfo() *jsx.JSONObject {
	return jsx.NewJSONObject().Set("name", s.catalog.ServerName).Set("version", s.catalog.ServerVersion)
}

func methodNotFound(id any) outcome {
	return outcome{errorMessage(id, codeMethodNotFound, "Method not found", nil), true}
}

// handleLegacy is Protocol._onrequest on a 2025-era instance.
func (s *Server) handleLegacy(ctx context.Context, msg *jsx.JSONObject, auth *AuthInfo) outcome {
	id := mustGet(msg, "id")
	method := methodOf(msg)
	switch method {
	case "initialize":
		if _, err := z.Parse(initializeRequest, plain(msg)); err != nil {
			return outcome{msg: errorMessage(id, codeInternalError, issuesError(err), nil)}
		}
		requested, _ := mustGet(paramsOf(msg), "protocolVersion").(string)
		version := latestProtocolVersion
		if slices.Contains(supportedProtocolVersions, requested) {
			version = requested
		}
		res := jsx.NewJSONObject().Set("protocolVersion", version).Set("capabilities", capabilities()).
			Set("serverInfo", s.serverInfo())
		if s.catalog.Instructions != "" {
			res.Set("instructions", s.catalog.Instructions)
		}
		return outcome{msg: resultMessage(id, res)}
	case "ping":
		if _, err := z.Parse(pingRequest, plain(msg)); err != nil {
			return outcome{msg: errorMessage(id, codeInternalError, issuesError(err), nil)}
		}
		return outcome{msg: resultMessage(id, jsx.NewJSONObject())}
	case "tools/list":
		if _, err := z.Parse(listToolsRequest, plain(msg)); err != nil {
			return outcome{msg: errorMessage(id, codeInternalError, issuesError(err), nil)}
		}
		return outcome{msg: resultMessage(id, jsx.NewJSONObject().Set("tools", s.catalog.Tools))}
	case "tools/call":
		parsed, err := z.Parse(callToolRequest, plain(msg))
		if err != nil {
			return outcome{msg: errorMessage(id, codeInvalidParams, "Invalid tools/call request: "+issuesError(err), nil)}
		}
		res, perr := s.callTool(ctx, parsed.(map[string]any)["params"].(map[string]any), auth)
		if perr != nil {
			return outcome{msg: errorMessage(id, perr.code, perr.message, nil)}
		}
		return outcome{msg: resultMessage(id, res)}
	}
	return methodNotFound(id)
}

// liftEnvelope is liftWireOnlyMaterial for a request: the reserved _meta keys
// and the retry fields leave params.
func liftEnvelope(msg *jsx.JSONObject) (*jsx.JSONObject, *jsx.JSONObject) {
	params := paramsOf(msg)
	if params == nil {
		return msg, nil
	}
	meta, _ := obj(mustGet(params, "_meta"))
	var envKeys []string
	if meta != nil {
		for _, k := range []string{protocolVersionMetaKey, clientInfoMetaKey, clientCapsMetaKey, logLevelMetaKey} {
			if _, ok := meta.Get(k); ok {
				envKeys = append(envKeys, k)
			}
		}
	}
	var retry []string
	for _, k := range []string{"inputResponses", "requestState"} {
		if _, ok := params.Get(k); ok {
			retry = append(retry, k)
		}
	}
	if len(envKeys) == 0 && len(retry) == 0 {
		return msg, nil
	}
	next := jsx.NewJSONObject()
	var envelope *jsx.JSONObject
	for _, k := range params.Keys() {
		v, _ := params.Get(k)
		if slices.Contains(retry, k) {
			continue
		}
		if k == "_meta" && len(envKeys) > 0 {
			envelope = jsx.NewJSONObject()
			rest := jsx.NewJSONObject()
			for _, mk := range meta.Keys() {
				mv, _ := meta.Get(mk)
				if slices.Contains(envKeys, mk) {
					continue
				}
				rest.Set(mk, mv)
			}
			for _, ek := range envKeys {
				ev, _ := meta.Get(ek)
				envelope.Set(ek, ev)
			}
			if rest.Len() > 0 {
				next.Set("_meta", rest)
			}
			continue
		}
		next.Set(k, v)
	}
	out := jsx.NewJSONObject()
	for _, k := range msg.Keys() {
		v, _ := msg.Get(k)
		if k == "params" {
			v = next
		}
		out.Set(k, v)
	}
	return out, envelope
}

var (
	dispatchMeta   = z.Object(z.F("progressToken", z.Optional(progressToken))).Loose()
	modernListReq  = dispatchRequest("tools/list", z.F("cursor", z.Optional(z.String())))
	modernCallReq  = dispatchRequest("tools/call", z.F("name", z.String()), z.F("arguments", z.Optional(z.Record(z.String(), z.Unknown()))))
	modernDiscover = dispatchRequest("server/discover")
)

func dispatchRequest(method string, fields ...z.Field) z.Schema {
	return z.Object(
		z.F("method", z.Literal(method)),
		z.F("params", z.Optional(z.Object(append([]z.Field{z.F("_meta", z.Optional(dispatchMeta))}, fields...)...))),
	)
}

// handleModern is Protocol._onrequest on a 2026-07-28 instance.
func (s *Server) handleModern(ctx context.Context, raw *jsx.JSONObject, auth *AuthInfo) outcome {
	msg, envelope := liftEnvelope(raw)
	id := mustGet(msg, "id")
	method := methodOf(msg)
	if method != "tools/list" && method != "tools/call" && method != "server/discover" {
		return methodNotFound(id)
	}
	if envelope == nil {
		return outcome{errorMessage(id, codeInvalidParams, "Request is missing the required _meta envelope for protocol revision 2026-07-28 (io.modelcontextprotocol/protocolVersion, io.modelcontextprotocol/clientCapabilities)", nil), true}
	}
	if _, err := z.Parse(envelopeSchema, plain(envelope)); err != nil {
		msgs := ""
		for i, is := range err.(*z.Error).Issues {
			if i > 0 {
				msgs += "; "
			}
			msgs += is.Message()
		}
		return outcome{errorMessage(id, codeInvalidParams, "Invalid _meta envelope for protocol revision 2026-07-28: "+msgs, nil), true}
	}
	var res *jsx.JSONObject
	switch method {
	case "server/discover":
		if _, err := z.Parse(modernDiscover, plain(msg)); err != nil {
			return outcome{msg: errorMessage(id, codeInternalError, issuesError(err), nil)}
		}
		res = jsx.NewJSONObject().Set("supportedVersions", []any{firstModernVersion}).Set("capabilities", capabilities())
		if s.catalog.Instructions != "" {
			res.Set("instructions", s.catalog.Instructions)
		}
	case "tools/list":
		if _, err := z.Parse(modernListReq, plain(msg)); err != nil {
			return outcome{msg: errorMessage(id, codeInternalError, issuesError(err), nil)}
		}
		res = jsx.NewJSONObject().Set("tools", s.catalog.Tools)
	case "tools/call":
		parsed, err := z.Parse(modernCallReq, plain(msg))
		if err != nil {
			return outcome{msg: errorMessage(id, codeInvalidParams, "Invalid tools/call request: "+issuesError(err), nil)}
		}
		params, _ := parsed.(map[string]any)["params"].(map[string]any)
		var perr *protocolError
		res, perr = s.callTool(ctx, params, auth)
		if perr != nil {
			return outcome{msg: errorMessage(id, perr.code, perr.message, nil)}
		}
	}
	// The 2026 encode seam: resultType, cache fields, serverInfo stamp.
	res.Set("resultType", "complete")
	if method == "tools/list" || method == "server/discover" {
		res.Set("ttlMs", float64(0)).Set("cacheScope", "private")
	}
	res.Set("_meta", jsx.NewJSONObject().Set(serverInfoMetaKey, s.serverInfo()))
	return outcome{msg: resultMessage(id, res)}
}

type protocolError struct {
	code    int
	message string
}
