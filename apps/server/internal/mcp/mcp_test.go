package mcp

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

func parse(t *testing.T, s string) any {
	t.Helper()
	v, err := jsx.ParseJSON([]byte(s))
	require.NoError(t, err)
	return v
}

func TestJSONRPCShapes(t *testing.T) {
	require.True(t, isRequest(parse(t, `{"jsonrpc":"2.0","id":1,"method":"ping"}`)))
	require.True(t, isRequest(parse(t, `{"jsonrpc":"2.0","id":"a","method":"x","params":{"_meta":{"progressToken":"t"}}}`)))
	require.False(t, isRequest(parse(t, `{"jsonrpc":"2.0","id":1.5,"method":"ping"}`)), "ids are strings or integers")
	require.False(t, isRequest(parse(t, `{"jsonrpc":"2.0","id":1,"method":"ping","x":1}`)), "strict")
	require.False(t, isRequest(parse(t, `{"jsonrpc":"2.0","id":1,"method":"ping","params":[]}`)))
	require.False(t, isRequest(parse(t, `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"_meta":{"progressToken":1.5}}}`)))
	require.True(t, isNotification(parse(t, `{"jsonrpc":"2.0","method":"n"}`)))
	require.False(t, isNotification(parse(t, `{"jsonrpc":"1.0","method":"n"}`)))
	require.True(t, isResultResponse(parse(t, `{"jsonrpc":"2.0","id":1,"result":{}}`)))
	require.False(t, isResultResponse(parse(t, `{"jsonrpc":"2.0","id":1,"result":{"_meta":1}}`)))
	require.True(t, isErrorResponse(parse(t, `{"jsonrpc":"2.0","error":{"code":1,"message":"m"}}`)))
	require.False(t, isErrorResponse(parse(t, `{"jsonrpc":"2.0","error":{"code":1.5,"message":"m"}}`)))
	require.Equal(t, 1.5, echoableID(parse(t, `{"method":"x","id":1.5}`)))
	require.Nil(t, echoableID(parse(t, `{"id":1}`)))
	require.Nil(t, echoableID(parse(t, `[{"method":"x","id":1}]`)))
}

func TestClassify(t *testing.T) {
	str := func(s string) *string { return &s }
	env := `"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}`
	cases := []struct {
		name string
		h    stdHeaders
		body string
		kind string
		text string
	}{
		{"legacy request", stdHeaders{}, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, "legacy", ""},
		{"initialize", stdHeaders{}, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`, "legacy", ""},
		{"initialize modern header", stdHeaders{version: str("2026-07-28")}, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`, "reject",
			"Bad Request: the request headers and body disagree: an initialize request (legacy handshake) was sent with a modern MCP-Protocol-Version header"},
		{"modern", stdHeaders{}, `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{` + env + `}}`, "modern", ""},
		{"modern initialize", stdHeaders{}, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{` + env + `}}`, "modern", ""},
		{"version mismatch", stdHeaders{version: str(" 2026-07-29 ")}, `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{` + env + `}}`, "reject",
			"Bad Request: the request headers and body disagree: the body envelope names protocol version 2026-07-28 but the MCP-Protocol-Version header names 2026-07-29"},
		{"method mismatch", stdHeaders{method: str("x")}, `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{` + env + `}}`, "reject",
			"Bad Request: the request headers and body disagree: the body names method tools/list but the Mcp-Method header names x"},
		{"envelope missing caps", stdHeaders{}, `{"jsonrpc":"2.0","id":1,"method":"x","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}`, "reject",
			"Invalid _meta envelope for protocol revision 2026-07-28: io.modelcontextprotocol/clientCapabilities: missing"},
		{"header without claim", stdHeaders{version: str("2026-07-28")}, `{"jsonrpc":"2.0","id":1,"method":"x"}`, "reject",
			"Invalid params: the MCP-Protocol-Version header names protocol revision 2026-07-28, but the request is missing the required per-request envelope key(s): _meta"},
		{"header-only notification", stdHeaders{version: str("2026-07-28")}, `{"jsonrpc":"2.0","method":"n"}`, "modern", ""},
		{"empty batch", stdHeaders{}, `[]`, "reject", "Bad Request: empty JSON-RPC batch"},
		{"batch", stdHeaders{}, `[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":1,"result":{}}]`, "legacy", ""},
		{"modern in batch", stdHeaders{}, `[{"jsonrpc":"2.0","id":1,"method":"x","params":{` + env + `}}]`, "reject",
			"Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later"},
		{"invalid", stdHeaders{}, `{"x":1}`, "reject", "Bad Request: the request body is not a valid JSON-RPC message"},
		{"response", stdHeaders{}, `{"jsonrpc":"2.0","id":1,"result":{}}`, "legacy", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := classify(c.h, parse(t, c.body))
			require.Equal(t, c.kind, r.kind)
			require.Equal(t, c.text, r.text)
		})
	}
}

func TestContentType(t *testing.T) {
	for header, want := range map[string]bool{
		"application/json":                 true,
		"Application/JSON":                 true,
		"application/json; charset=utf-8":  true,
		`application/json; a="b\"c"; d=e`:  true,
		"application/json; ;":              true, // the essence fallback
		"application/json, text/plain":     false,
		"text/plain":                       false,
		"application/jsonx":                false,
		"":                                 false,
		" application/json ; charset=utf8": true,
	} {
		require.Equal(t, want, isJSONContentType(header, true), header)
	}
	require.False(t, isJSONContentType("", false))
}

func TestDecodeParamValue(t *testing.T) {
	v, ok := decodeParamValue("plain")
	require.True(t, ok)
	require.Equal(t, "plain", v)
	v, ok = decodeParamValue("=?base64?Z2V0X21vaF9zdGF0dXM=?=")
	require.True(t, ok)
	require.Equal(t, "get_moh_status", v)
	_, ok = decodeParamValue("=?base64?***?=")
	require.False(t, ok)
	_, ok = decodeParamValue("=?base64?/w==?=")
	require.False(t, ok, "invalid UTF-8 is refused")
	v, ok = decodeParamValue("=?base64?=")
	require.True(t, ok, "prefix and suffix overlap: an empty payload")
	require.Empty(t, v)
}

func TestHeaderQuotedValue(t *testing.T) {
	require.Equal(t, `a\"b\\c  d`, headerQuotedValue("a\"b\\c\n\td"))
	require.Equal(t, "x  y", headerQuotedValue("x😀y"), "an astral character is two UTF-16 units")
}

func TestHTMLToText(t *testing.T) {
	html := "<html><head><STYLE>p{}</style><script type=x>alert(1)</SCRIPT></head><body><h1>Title</h1>" +
		"<p>a&nbsp;&amp;&lt;b&gt;</p><br/><br ><div>c   \t d</div>\n\n\n\n<li>e</li></body></html>"
	require.Equal(t, "Title\n a &<b>\n\n c d\n\n e", htmlToText(html))
	require.Equal(t, "<scriptless", htmlToText("<scriptless"), "an unclosed script tag is only a tag")
}

func TestFapiURL(t *testing.T) {
	u, err := FapiURL("pk_test_" + "Y2xlcmsuZXhhbXBsZS5jb20k")
	require.NoError(t, err)
	require.Equal(t, "https://clerk.example.com", u)
	_, err = FapiURL("pk_test_***")
	require.Error(t, err)
}

func TestE2EVerifier(t *testing.T) {
	info, err := E2EVerifier(context.Background(), nil, "e2e-mcp|u1|migraine:read,migraine:write|c1", true)
	require.NoError(t, err)
	require.Equal(t, &AuthInfo{Token: "e2e-mcp|u1|migraine:read,migraine:write|c1", ClientID: "c1", Scopes: []string{"migraine:read", "migraine:write"}, UserID: "u1"}, info)
	info, err = E2EVerifier(context.Background(), nil, "e2e-mcp|u1", true)
	require.NoError(t, err)
	require.Equal(t, "e2e-client", info.ClientID)
	require.Empty(t, info.Scopes)
	info, err = E2EVerifier(context.Background(), nil, "other", true)
	require.NoError(t, err)
	require.Nil(t, info)
	_, err = E2EVerifier(context.Background(), nil, "e2e-mcp-throw", true)
	require.Error(t, err)
}

func TestLiftEnvelope(t *testing.T) {
	msg := parse(t, `{"jsonrpc":"2.0","id":1,"method":"m","params":{"a":1,"requestState":"s","_meta":{"progressToken":"p","io.modelcontextprotocol/protocolVersion":"v","io.modelcontextprotocol/logLevel":"info"}}}`).(*jsx.JSONObject)
	out, env := liftEnvelope(msg)
	require.JSONEq(t, `{"jsonrpc":"2.0","id":1,"method":"m","params":{"a":1,"_meta":{"progressToken":"p"}}}`, string(jsx.Stringify(out, "")))
	require.JSONEq(t, `{"io.modelcontextprotocol/protocolVersion":"v","io.modelcontextprotocol/logLevel":"info"}`, string(jsx.Stringify(env, "")))
	plain := parse(t, `{"jsonrpc":"2.0","id":1,"method":"m"}`).(*jsx.JSONObject)
	same, env := liftEnvelope(plain)
	require.Same(t, plain, same)
	require.Nil(t, env)
}

// newTestHandler serves the catalog; only the audit table is used.
func newTestHandler(t *testing.T, keepAlive time.Duration) *httptest.Server {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv, err := NewServer(Services{}, q.New(testdb.New(t)), log, time.Now)
	require.NoError(t, err)
	h := NewHandler(srv, E2EVerifier, log)
	h.keepAlive = keepAlive
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	return ts
}

func post(t *testing.T, ts *httptest.Server, body string, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, ts.URL, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer e2e-mcp|u1|migraine:read|c")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

func readAll(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return string(b)
}

func TestLegacyTransport(t *testing.T) {
	ts := newTestHandler(t, 0)

	res := post(t, ts, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}`, nil)
	require.Equal(t, 200, res.StatusCode)
	require.Equal(t, "text/event-stream", res.Header.Get("Content-Type"))
	body := readAll(t, res)
	require.True(t, strings.HasPrefix(body, `event: message`+"\n"+`data: {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"migraine-club","version":"1.0.0"},"instructions":"`), body)
	require.True(t, strings.HasSuffix(body, `"},"jsonrpc":"2.0","id":1}`+"\n\n"), body)

	res = post(t, ts, `[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"nope"}]`, nil)
	require.Equal(t, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}\n\n"+
		"event: message\ndata: {\"result\":{},\"jsonrpc\":\"2.0\",\"id\":1}\n\n", readAll(t, res), "handler-less methods answer first")

	res = post(t, ts, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, nil)
	require.Equal(t, 202, res.StatusCode)
	require.Empty(t, readAll(t, res))

	res = post(t, ts, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, map[string]string{"Accept": "application/json"})
	require.Equal(t, 406, res.StatusCode)

	res = post(t, ts, `{`, nil)
	require.Equal(t, 400, res.StatusCode)
	require.Equal(t, `{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error: Invalid JSON"},"id":null}`, readAll(t, res))

	res = post(t, ts, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, map[string]string{"Authorization": "Bearer nope", "X-Forwarded-Host": "mcp.test"})
	require.Equal(t, 401, res.StatusCode)
	require.Equal(t, `Bearer error="invalid_token", error_description="No authorization provided", resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/mcp"`, res.Header.Get("WWW-Authenticate"))

	res = post(t, ts, `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"log_attack","arguments":{"intensity":3}}}`, nil)
	require.Contains(t, readAll(t, res), `This action requires the \"migraine:write\" scope`, "scopes are checked before the tool runs")

	res = post(t, ts, `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"list_attacks","arguments":{"limit":0}}}`, nil)
	require.Contains(t, readAll(t, res), `"text":"Input validation error: Invalid arguments for tool list_attacks: limit: Too small: expected number to be >=1"}],"isError":true}`)
}

func TestModernTransport(t *testing.T) {
	ts := newTestHandler(t, 0)
	env := `"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}`
	h := map[string]string{"Mcp-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover", "Accept": ""}

	res := post(t, ts, `{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{`+env+`}}`, h)
	require.Equal(t, 200, res.StatusCode)
	require.Equal(t, "application/json", res.Header.Get("Content-Type"))
	body := readAll(t, res)
	require.True(t, strings.HasPrefix(body, `{"result":{"supportedVersions":["2026-07-28"],"capabilities":{"tools":{"listChanged":true}},"instructions":"`), body)
	require.True(t, strings.HasSuffix(body, `","resultType":"complete","ttlMs":0,"cacheScope":"private","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"migraine-club","version":"1.0.0"}}},"jsonrpc":"2.0","id":1}`), body)

	h["Mcp-Method"] = "ping"
	res = post(t, ts, `{"jsonrpc":"2.0","id":2,"method":"ping","params":{`+env+`}}`, h)
	require.Equal(t, 404, res.StatusCode, "the modern era has no ping")
	require.Equal(t, `{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}`, readAll(t, res))

	delete(h, "Mcp-Method")
	res = post(t, ts, `{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{`+env+`}}`, h)
	require.Equal(t, 400, res.StatusCode)
	require.Contains(t, readAll(t, res), `the body names method tools/list but the required Mcp-Method header is absent`)
}

func TestListenStream(t *testing.T) {
	ts := newTestHandler(t, 20*time.Millisecond)
	env := `"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}`
	h := map[string]string{"Mcp-Protocol-Version": "2026-07-28", "Mcp-Method": "subscriptions/listen"}

	res := post(t, ts, `{"jsonrpc":"2.0","id":"s","method":"subscriptions/listen","params":{`+env+`,"notifications":{"resourcesListChanged":true}}}`, h)
	require.Equal(t, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/subscriptions/acknowledged\",\"params\":{\"notifications\":{},\"_meta\":{\"io.modelcontextprotocol/subscriptionId\":\"s\"}}}\n\n"+
		"event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":\"s\",\"result\":{\"resultType\":\"complete\",\"_meta\":{\"io.modelcontextprotocol/subscriptionId\":\"s\",\"io.modelcontextprotocol/serverInfo\":{\"name\":\"migraine-club\",\"version\":\"1.0.0\"}}}}\n\n",
		readAll(t, res), "nothing honored: acknowledged and closed")

	ctx, cancel := context.WithCancel(t.Context())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"subscriptions/listen","params":{`+env+`,"notifications":{"toolsListChanged":true}}}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer e2e-mcp|u1|migraine:read|c")
	for k, v := range h {
		req.Header.Set(k, v)
	}
	res, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	r := bufio.NewReader(res.Body)
	line, err := r.ReadString('\n')
	require.NoError(t, err)
	require.Equal(t, "event: message\n", line)
	line, _ = r.ReadString('\n')
	require.Contains(t, line, `"notifications":{"toolsListChanged":true}`)
	_, _ = r.ReadString('\n')
	line, err = r.ReadString('\n')
	require.NoError(t, err)
	require.Equal(t, ": keepalive\n", line, "the open subscription keeps the stream alive")
	cancel()
}
