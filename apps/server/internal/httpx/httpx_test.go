package httpx

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestJSONMatchesNextResponse(t *testing.T) {
	rec := httptest.NewRecorder()
	JSON(rec, 201, M{"msg": "a<b & c>d"})
	require.Equal(t, 201, rec.Code)
	require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	require.Equal(t, `{"msg":"a<b & c>d"}`, rec.Body.String())
}

func TestReadJSON(t *testing.T) {
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"a":1}`))
	v, err := ReadJSON(req)
	require.NoError(t, err)
	require.Equal(t, map[string]any{"a": float64(1)}, v)

	for _, body := range []string{"", "{", "nope"} {
		_, err := ReadJSON(httptest.NewRequest("POST", "/", strings.NewReader(body)))
		require.ErrorAs(t, err, &ErrInvalidJSON{}, body)
	}
	require.Equal(t, "fb", ReadJSONOr(httptest.NewRequest("POST", "/", strings.NewReader("")), "fb"))
}
