package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/denysovkos/migraine.club/internal/spa"
)

// The client build, when there is one (npm run build).
const clientDist = "../../../client/dist"

func distHandler(b *testing.B) (http.Handler, string) {
	b.Helper()
	assets, _ := filepath.Glob(filepath.Join(clientDist, "assets", "index-*.js"))
	if len(assets) == 0 {
		b.Skip("no client build; run npm run build first")
	}
	h, err := spa.New(os.DirFS(clientDist), spa.Config{})
	if err != nil {
		b.Fatal(err)
	}
	return compress(h), "/assets/" + filepath.Base(assets[0])
}

// BenchmarkStaticAsset serves the main bundle gzipped, as a browser asks.
func BenchmarkStaticAsset(b *testing.B) {
	h, asset := distHandler(b)
	b.ReportAllocs()
	for b.Loop() {
		req := httptest.NewRequest(http.MethodGet, asset, nil)
		req.Header.Set("Accept-Encoding", "gzip, deflate, br")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			b.Fatal(w.Code)
		}
	}
}

// BenchmarkPage serves a page (the shell with its head).
func BenchmarkPage(b *testing.B) {
	h, _ := distHandler(b)
	b.ReportAllocs()
	for b.Loop() {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Accept-Encoding", "gzip, deflate, br")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			b.Fatal(w.Code)
		}
	}
}
