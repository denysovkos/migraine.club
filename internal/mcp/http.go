package mcp

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/denysovkos/migraine.club/internal/jsx"
	z "github.com/denysovkos/migraine.club/internal/zod"
)

const (
	maxBodySize       = 4 * 1024 * 1024
	maxBatchSize      = 100
	keepAliveInterval = 15 * time.Second
	maxSubscriptions  = 1024
)

// Verifier checks a bearer token. It returns nil, nil when the token grants
// nothing ("no authorization") and an error when verification itself failed.
type Verifier func(ctx context.Context, r *http.Request, token string, present bool) (*AuthInfo, error)

// Handler serves /api/mcp as mcp-handler (createMcpHandler + withMcpAuth)
// did on @modelcontextprotocol/server.
type Handler struct {
	srv       *Server
	verify    Verifier
	log       *slog.Logger
	keepAlive time.Duration

	mu        sync.Mutex
	listeners int
}

// ServeHTTP is withMcpAuth around the MCP handler.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	metadataURL := publicOrigin(r) + "/.well-known/oauth-protected-resource/mcp"
	parts := strings.Split(strings.Join(r.Header.Values("Authorization"), ", "), " ")
	var token string
	var present bool
	if len(r.Header.Values("Authorization")) > 0 && strings.ToLower(parts[0]) == "bearer" && len(parts) > 1 {
		token, present = parts[1], true
	}
	info, err := h.verify(r.Context(), r, token, present)
	if err != nil {
		h.log.Error("Unexpected error authenticating bearer token", "error", err)
		challenge(w, "Invalid token", metadataURL)
		return
	}
	if info == nil {
		challenge(w, "No authorization provided", metadataURL)
		return
	}
	h.serve(w, r, info)
}

// headerQuotedValue escapes a quoted-string value; every UTF-16 code unit
// outside printable ASCII becomes a space.
func headerQuotedValue(v string) string {
	var b strings.Builder
	for _, r := range v {
		switch {
		case r == '\\' || r == '"':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r >= 0x20 && r <= 0x7e:
			b.WriteRune(r)
		default:
			b.WriteString(strings.Repeat(" ", len(utf16.Encode([]rune{r}))))
		}
	}
	return b.String()
}

func challenge(w http.ResponseWriter, description, metadataURL string) {
	w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer error="invalid_token", error_description="%s", resource_metadata="%s"`,
		headerQuotedValue(description), headerQuotedValue(metadataURL)))
	writeJSON(w, http.StatusUnauthorized, jsx.NewJSONObject().Set("error", "invalid_token").Set("error_description", description))
}

// publicOrigin is mcp-handler's getPublicOrigin.
func publicOrigin(r *http.Request) string {
	if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
		host := strings.TrimSpace(strings.Split(fh, ",")[0])
		proto := "https"
		if fp := r.Header.Get("X-Forwarded-Proto"); fp != "" {
			if p := strings.TrimSpace(strings.Split(fp, ",")[0]); p != "" {
				proto = p
			}
		}
		return proto + "://" + host
	}
	if fwd := r.Header.Get("Forwarded"); fwd != "" {
		var host, proto string
		for _, pair := range strings.Split(strings.Split(fwd, ",")[0], ";") {
			kv := strings.Split(pair, "=")
			key := strings.ToLower(strings.TrimSpace(kv[0]))
			val := ""
			if len(kv) > 1 {
				val = strings.ToLower(strings.TrimSpace(kv[1]))
			}
			switch {
			case key == "host" && val != "":
				host = strings.TrimSuffix(strings.TrimPrefix(val, `"`), `"`)
			case key == "proto" && val != "":
				proto = strings.TrimSuffix(strings.TrimPrefix(val, `"`), `"`)
			}
		}
		if host != "" {
			if proto == "" {
				proto = "https"
			}
			return proto + "://" + host
		}
	}
	return requestOrigin(r)
}

// requestOrigin is new URL(req.url).origin of the request Next handed over.
func requestOrigin(r *http.Request) string {
	u, err := url.Parse("http://" + r.Host)
	if err != nil {
		return "http://" + r.Host
	}
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if p := u.Port(); p != "" && p != "80" {
		host += ":" + p
	}
	return "http://" + host
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(jsx.Stringify(body, ""))
}

// rpcError is jsonRpcErrorResponse.
func rpcError(w http.ResponseWriter, status, code int, message string, data any, id any) {
	if status == http.StatusMethodNotAllowed {
		w.Header().Set("Allow", "POST")
	}
	writeJSON(w, status, errorBody(code, message, data, id))
}

// decodeBody is how Body.json() and TextDecoder read the bytes: UTF-8 with
// replacement characters, a leading BOM removed.
func decodeBody(b []byte) string { return jsx.UTF8Decode(b, true) }

func parseJSONText(text string) (any, bool) {
	v, err := jsx.ParseJSON([]byte(text))
	return v, err == nil
}

func (h *Handler) serve(w http.ResponseWriter, r *http.Request, auth *AuthInfo) {
	ct := strings.Join(r.Header.Values("Content-Type"), ", ")
	hasCT := len(r.Header.Values("Content-Type")) > 0
	raw, _ := io.ReadAll(r.Body)
	var parsed any
	var hasParsed bool
	if r.Method == http.MethodPost && strings.Contains(ct, "application/json") {
		parsed, hasParsed = parseJSONText(decodeBody(raw))
	}
	if r.Method == http.MethodPost && !isJSONContentType(ct, hasCT) {
		rpcError(w, 415, -32000, "Unsupported Media Type: Content-Type must be application/json", nil, nil)
		return
	}
	if r.Method != http.MethodPost {
		rpcError(w, 405, -32000, "Method not allowed.", nil, nil)
		return
	}
	if !hasParsed {
		if tooLarge(r, raw) {
			rpcError(w, 413, -32000, fmt.Sprintf("Payload Too Large: Request body must not exceed %d bytes", maxBodySize), nil, nil)
			return
		}
		text := decodeBody(raw)
		if text != "" {
			parsed, hasParsed = parseJSONText(text)
		}
		if !hasParsed {
			h.legacy(w, r, raw, nil, false, auth)
			return
		}
	}
	hdr := stdHeaders{
		version: headerPtr(r.Header.Get("Mcp-Protocol-Version"), len(r.Header.Values("Mcp-Protocol-Version")) > 0),
		method:  headerPtr(r.Header.Get("Mcp-Method"), len(r.Header.Values("Mcp-Method")) > 0),
		name:    headerPtr(r.Header.Get("Mcp-Name"), len(r.Header.Values("Mcp-Name")) > 0),
	}
	rt := classify(hdr, parsed)
	switch rt.kind {
	case "reject":
		h.log.Error("Rejected inbound request", "message", rt.text)
		rpcError(w, rt.status, rt.code, rt.text, rt.data, echoableID(parsed))
	case "modern":
		h.modern(w, r, hdr, rt, auth)
	default:
		h.legacy(w, r, raw, parsed, true, auth)
	}
}

func tooLarge(r *http.Request, raw []byte) bool {
	if cl, err := strconv.ParseFloat(strings.TrimSpace(r.Header.Get("Content-Length")), 64); err == nil && cl > maxBodySize {
		return true
	}
	return len(raw) > maxBodySize
}

// ---------- the 2025-era stateless transport ----------

func (h *Handler) legacy(w http.ResponseWriter, r *http.Request, raw []byte, body any, hasBody bool, auth *AuthInfo) {
	accept := strings.Join(r.Header.Values("Accept"), ", ")
	if !strings.Contains(accept, "application/json") || !strings.Contains(accept, "text/event-stream") {
		rpcError(w, 406, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream", nil, nil)
		return
	}
	if !hasBody {
		if tooLarge(r, raw) {
			rpcError(w, 413, -32000, fmt.Sprintf("Payload Too Large: Request body must not exceed %d bytes", maxBodySize), nil, nil)
			return
		}
		v, ok := parseJSONText(decodeBody(raw))
		if !ok {
			rpcError(w, 400, codeParseError, "Parse error: Invalid JSON", nil, nil)
			return
		}
		body = v
	}
	var messages []any
	if arr, ok := body.([]any); ok {
		if len(arr) > maxBatchSize {
			rpcError(w, 400, codeInvalidRequest, fmt.Sprintf("Invalid Request: Batch must not exceed %d messages", maxBatchSize), nil, nil)
			return
		}
		messages = arr
	} else {
		messages = []any{body}
	}
	for _, m := range messages {
		if !isMessage(m) {
			rpcError(w, 400, codeParseError, "Parse error: Invalid JSON-RPC message", nil, nil)
			return
		}
	}
	hasInit := false
	for _, m := range messages {
		if isRequest(m) && methodOf(m.(*jsx.JSONObject)) == "initialize" {
			if _, err := z.Parse(initializeRequest, plain(m)); err == nil {
				hasInit = true
			}
		}
	}
	if hasInit && len(messages) > 1 {
		rpcError(w, 400, codeInvalidRequest, "Invalid Request: Only one initialization request is allowed", nil, nil)
		return
	}
	if !hasInit {
		if vs := r.Header.Values("Mcp-Protocol-Version"); len(vs) > 0 {
			v := strings.Join(vs, ", ")
			if !slices.Contains(supportedProtocolVersions, v) {
				rpcError(w, 400, -32000, fmt.Sprintf("Bad Request: Unsupported protocol version: %s (supported versions: %s)", v, strings.Join(supportedProtocolVersions, ", ")), nil, nil)
				return
			}
		}
	}
	var requests []*jsx.JSONObject
	for _, m := range messages {
		if isRequest(m) {
			requests = append(requests, m.(*jsx.JSONObject))
		}
	}
	if len(requests) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	sse := newSSE(w)
	h.streamLegacy(r.Context(), sse, requests, auth)
}

// idKey is the JavaScript Map key of a request id.
func idKey(id any) string {
	switch v := id.(type) {
	case string:
		return "s" + v
	case float64:
		return "n" + jsx.FormatNumber(v)
	}
	return ""
}

// isInstant reports whether Node answered the request without waiting on
// I/O: everything but a tools/call that reaches a tool handler.
func (h *Handler) isInstant(m *jsx.JSONObject, auth *AuthInfo) bool {
	if methodOf(m) != "tools/call" {
		return true
	}
	parsed, err := z.Parse(callToolRequest, plain(m))
	if err != nil {
		return true
	}
	params := parsed.(map[string]any)["params"].(map[string]any)
	name, _ := params["name"].(string)
	def, ok := h.srv.tools[name]
	if !ok {
		return true
	}
	if def.input != nil {
		raw, present := params["arguments"]
		if !present {
			raw = map[string]any{}
		}
		if _, err := z.Parse(def.input, raw); err != nil {
			return true
		}
	}
	return auth == nil || auth.UserID == "" || !slices.Contains(auth.Scopes, def.scope)
}

// streamLegacy answers every request on one SSE stream: instant answers in
// request order, then the rest as they finish; the stream ends when every
// request id has an answer.
func (h *Handler) streamLegacy(ctx context.Context, sse *sseWriter, requests []*jsx.JSONObject, auth *AuthInfo) {
	pending := map[string]bool{}
	for _, m := range requests {
		pending[idKey(mustGet(m, "id"))] = true
	}
	var mu sync.Mutex
	closed := false
	deliver := func(msg *jsx.JSONObject) {
		mu.Lock()
		defer mu.Unlock()
		key := idKey(mustGet(msg, "id"))
		if closed || !pending[key] {
			return
		}
		sse.message(msg)
		delete(pending, key)
		if len(pending) == 0 {
			closed = true
		}
	}
	// Protocol answered a method without a handler synchronously while the
	// batch was still being dispatched; handlers answered afterwards.
	var rest []*jsx.JSONObject
	for _, m := range requests {
		switch methodOf(m) {
		case "initialize", "ping", "tools/list", "tools/call":
			rest = append(rest, m)
		default:
			deliver(methodNotFound(mustGet(m, "id")).msg)
		}
	}
	var slow []*jsx.JSONObject
	for _, m := range rest {
		if h.isInstant(m, auth) {
			deliver(h.srv.handleLegacy(ctx, m, auth).msg)
		} else {
			slow = append(slow, m)
		}
	}
	done := make(chan *jsx.JSONObject)
	for _, m := range slow {
		go func() { done <- h.srv.handleLegacy(ctx, m, auth).msg }()
	}
	stop := sse.keepAlive(h.keepAlive)
	defer stop()
	for range slow {
		select {
		case msg := <-done:
			deliver(msg)
		case <-ctx.Done():
			return
		}
	}
}

// ---------- the 2026-07-28 per-request transport ----------

func (h *Handler) modern(w http.ResponseWriter, r *http.Request, hdr stdHeaders, rt route, auth *AuthInfo) {
	id := echoableID(rt.message)
	if rt.revision == "" || !slices.Contains(supportedModernVersions, rt.revision) {
		requested := rt.revision
		if requested == "" {
			requested = "unknown"
		}
		rpcError(w, 400, codeUnsupportedVersion, "Unsupported protocol version: "+requested,
			jsx.NewJSONObject().Set("supported", []any{firstModernVersion}).Set("requested", requested), id)
		return
	}
	if rt.notification {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	if rej, bad := standardHeaderRejection(hdr, rt); bad {
		h.log.Error("Rejected inbound request", "message", rej.text)
		rpcError(w, rej.status, rej.code, rej.text, rej.data, id)
		return
	}
	if methodOf(rt.message) == "subscriptions/listen" {
		h.listen(w, r, rt.message)
		return
	}
	out := h.srv.handleModern(r.Context(), rt.message, auth)
	status := http.StatusOK
	if out.sync {
		if e, ok := obj(mustGet(out.msg, "error")); ok {
			switch int(mustGet(e, "code").(float64)) {
			case codeParseError, codeInvalidRequest, codeUnsupportedVersion, codeMissingClientCap, codeHeaderMismatch:
				status = 400
			case codeMethodNotFound:
				status = 404
			}
		}
	}
	writeJSON(w, status, out.msg)
}

// standardHeaderRejection is validateStandardRequestHeaders.
func standardHeaderRejection(hdr stdHeaders, rt route) (route, bool) {
	method := methodOf(rt.message)
	if hdr.version == nil {
		return mismatch("(missing)", fmt.Sprintf("the body envelope names protocol version %s but the required MCP-Protocol-Version header is absent", rt.revision)), true
	}
	if hdr.method == nil {
		return mismatch("(missing)", fmt.Sprintf("the body names method %s but the required Mcp-Method header is absent", method)), true
	}
	fields := map[string]string{"tools/call": "name", "prompts/get": "name", "resources/read": "uri",
		"tasks/get": "taskId", "tasks/update": "taskId", "tasks/cancel": "taskId"}
	field, ok := fields[method]
	if !ok {
		return route{}, false
	}
	bodyValue, hasValue := mustGet(paramsOf(rt.message), field).(string)
	if hdr.name == nil {
		if !hasValue {
			return route{}, false
		}
		return mismatch("(missing)", fmt.Sprintf(`the body carries params.%s="%s" but the required Mcp-Name header is absent`, field, bodyValue)), true
	}
	normalized := stripOWS(*hdr.name)
	decoded, valid := decodeParamValue(normalized)
	if !valid {
		return mismatch(normalized, "the Mcp-Name header carries an invalid Base64 sentinel value"), true
	}
	if hasValue && decoded != bodyValue {
		return mismatch(normalized, fmt.Sprintf(`the body carries params.%s="%s" but the Mcp-Name header names "%s"`, field, bodyValue, decoded)), true
	}
	return route{}, false
}

// listen is the listen router's serve: an acknowledged subscription that
// only ever carries keepalives (this server publishes no list changes).
func (h *Handler) listen(w http.ResponseWriter, r *http.Request, msg *jsx.JSONObject) {
	id := mustGet(msg, "id")
	plainErr := func(code int, message string) {
		writeJSON(w, 200, jsx.NewJSONObject().Set("jsonrpc", "2.0").
			Set("error", jsx.NewJSONObject().Set("code", float64(code)).Set("message", message)).Set("id", id))
	}
	h.mu.Lock()
	full := h.listeners >= maxSubscriptions
	h.mu.Unlock()
	if full {
		plainErr(codeInternalError, "Subscription limit reached")
		return
	}
	parsed, err := z.Parse(listenRequest, plain(msg))
	if err != nil {
		plainErr(codeInvalidParams, "Invalid params: 'notifications' is required and must be a valid SubscriptionFilter")
		return
	}
	filter := parsed.(map[string]any)["params"].(map[string]any)["notifications"].(map[string]any)
	honored := jsx.NewJSONObject()
	if filter["toolsListChanged"] == true {
		honored.Set("toolsListChanged", true)
	}
	sse := newSSE(w)
	sse.message(jsx.NewJSONObject().Set("jsonrpc", "2.0").Set("method", "notifications/subscriptions/acknowledged").
		Set("params", jsx.NewJSONObject().Set("notifications", honored).
			Set("_meta", jsx.NewJSONObject().Set(subscriptionIDMetaKey, id))))
	if honored.Len() == 0 {
		sse.message(jsx.NewJSONObject().Set("jsonrpc", "2.0").Set("id", id).Set("result",
			jsx.NewJSONObject().Set("resultType", "complete").Set("_meta", jsx.NewJSONObject().
				Set(subscriptionIDMetaKey, id).Set(serverInfoMetaKey, h.srv.serverInfo()))))
		return
	}
	h.mu.Lock()
	h.listeners++
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		h.listeners--
		h.mu.Unlock()
	}()
	stop := sse.keepAlive(h.keepAlive)
	defer stop()
	<-r.Context().Done()
}

var listenRequest = z.Object(
	z.F("method", z.Literal("subscriptions/listen")),
	z.F("params", z.Object(
		z.F("_meta", envelopeSchema),
		z.F("notifications", z.Object(
			z.F("toolsListChanged", z.Optional(z.Boolean())),
			z.F("promptsListChanged", z.Optional(z.Boolean())),
			z.F("resourcesListChanged", z.Optional(z.Boolean())),
			z.F("resourceSubscriptions", z.Optional(z.Array(z.String()))),
		)),
	)),
)

// ---------- SSE ----------

type sseWriter struct {
	mu sync.Mutex
	w  http.ResponseWriter
}

func newSSE(w http.ResponseWriter) *sseWriter {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flush(w)
	return &sseWriter{w: w}
}

func flush(w http.ResponseWriter) {
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *sseWriter) frame(text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = io.WriteString(s.w, text)
	flush(s.w)
}

func (s *sseWriter) message(msg *jsx.JSONObject) {
	var b bytes.Buffer
	b.WriteString("event: message\ndata: ")
	b.Write(jsx.Stringify(msg, ""))
	b.WriteString("\n\n")
	s.frame(b.String())
}

// keepAlive writes ": keepalive" comments until stopped.
func (s *sseWriter) keepAlive(every time.Duration) func() {
	if every <= 0 {
		return func() {}
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	t := time.NewTicker(every)
	go func() {
		defer close(done)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				s.frame(": keepalive\n\n")
			case <-stop:
				return
			}
		}
	}()
	var once sync.Once
	// Waits for the writer goroutine: the ResponseWriter must not be touched
	// once the handler has returned.
	return func() {
		once.Do(func() { close(stop) })
		<-done
	}
}
