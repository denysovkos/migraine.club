package server

import (
	"compress/flate"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/spa"
)

// The client build's files are gzipped once at startup instead of on every
// request. The responses must be what the compression middleware sent.
func TestStaticFilesAreServedPrecompressed(t *testing.T) {
	js := strings.Repeat("console.log('migraine');\n", 200)
	dist := fstest.MapFS{
		"index.html":        {Data: []byte("<!doctype html><html><head><!--app-head--></head><body></body></html>")},
		"heads.json":        {Data: []byte(`{}`)},
		"routes.json":       {Data: []byte(`[]`)},
		"assets/index-1.js": {Data: []byte(js)},
		"robots.txt":        {Data: []byte("User-Agent: *")},
		"logo.png":          {Data: []byte("png")},
	}
	h, err := spa.New(dist, spa.Config{})
	require.NoError(t, err)
	srv := compress(h)
	get := func(method, path, accept string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		if accept != "" {
			req.Header.Set("Accept-Encoding", accept)
		}
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, req)
		return w
	}

	gz := get(http.MethodGet, "/assets/index-1.js", "gzip, deflate, br")
	require.Equal(t, http.StatusOK, gz.Code)
	require.Equal(t, "gzip", gz.Header().Get("Content-Encoding"))
	require.Equal(t, []string{"Accept-Encoding"}, gz.Header().Values("Vary"))
	require.Equal(t, "application/javascript; charset=UTF-8", gz.Header().Get("Content-Type"))
	require.Equal(t, "public, max-age=31536000, immutable", gz.Header().Get("Cache-Control"))
	zr, err := gzip.NewReader(gz.Body)
	require.NoError(t, err)
	plain, err := io.ReadAll(zr)
	require.NoError(t, err)
	require.Equal(t, js, string(plain))

	robots := get(http.MethodGet, "/robots.txt", "gzip")
	require.Equal(t, "gzip", robots.Header().Get("Content-Encoding"))
	require.Equal(t, []string{NextVary, "Accept-Encoding"}, robots.Header().Values("Vary"), "a metadata route keeps Next's Vary first")

	// Deflate only: compressed by the middleware, as before.
	df := get(http.MethodGet, "/assets/index-1.js", "deflate")
	require.Equal(t, "deflate", df.Header().Get("Content-Encoding"))
	plain, err = io.ReadAll(flate.NewReader(df.Body))
	require.NoError(t, err)
	require.Equal(t, js, string(plain))

	none := get(http.MethodGet, "/assets/index-1.js", "")
	require.Empty(t, none.Header().Get("Content-Encoding"))
	require.Equal(t, js, none.Body.String())

	head := get(http.MethodHead, "/assets/index-1.js", "gzip")
	require.Empty(t, head.Header().Get("Content-Encoding"), "HEAD is not compressed")
	require.Equal(t, []string{"Accept-Encoding"}, head.Header().Values("Vary"))
	require.Empty(t, head.Body.String())

	png := get(http.MethodGet, "/logo.png", "gzip")
	require.Empty(t, png.Header().Get("Content-Encoding"), "images are not compressible")
	require.Equal(t, "png", png.Body.String())

	require.Equal(t, http.StatusNotFound, get(http.MethodGet, "/routes.json", "gzip").Code, "build metadata is not served")
}
