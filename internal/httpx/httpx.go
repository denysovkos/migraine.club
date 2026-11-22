// Package httpx holds the response and request helpers every handler uses.
//
// JSON responses are written the way NextResponse.json wrote them: the body is
// exactly JSON.stringify(value) (no HTML escaping, no trailing newline) with
// content-type application/json.
package httpx

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/denysovkos/migraine.club/internal/zod"
)

// M is an unordered JSON object. Prefer O for responses: Go maps marshal
// with sorted keys, JavaScript objects keep insertion order.
type M = map[string]any

// Marshal encodes like JSON.stringify.
func Marshal(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}

// JSON writes v with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	body, err := Marshal(v)
	if err != nil {
		http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// Error writes {"error": msg}.
func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, O("error", msg))
}

// Unauthorized writes the 401 every authenticated route returns.
func Unauthorized(w http.ResponseWriter) { Error(w, http.StatusUnauthorized, "Unauthorized") }

// Internal writes the generic 500.
func Internal(w http.ResponseWriter) { Error(w, http.StatusInternalServerError, "Internal server error") }

// ValidationError writes {"error": "Validation error", "details": issues}.
func ValidationError(w http.ResponseWriter, err *zod.Error) {
	JSON(w, http.StatusBadRequest, O("error", "Validation error", "details", err.Issues))
}

// ErrInvalidJSON is returned by ReadJSON for a body `request.json()` would
// reject with a SyntaxError.
type ErrInvalidJSON struct{ Err error }

func (e ErrInvalidJSON) Error() string { return e.Err.Error() }

// ReadJSON reads the body like `await request.json()`: an empty or malformed
// body is an error. The value is a tree for the zod package.
func ReadJSON(r *http.Request) (any, error) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, ErrInvalidJSON{io.ErrUnexpectedEOF}
	}
	v, err := zod.Decode(raw)
	if err != nil {
		return nil, ErrInvalidJSON{err}
	}
	return v, nil
}

// ReadJSONOr reads the body like `await request.json().catch(() => fallback)`.
func ReadJSONOr(r *http.Request, fallback any) any {
	v, err := ReadJSON(r)
	if err != nil {
		return fallback
	}
	return v
}

// Object is a JSON object that keeps insertion order, like a JavaScript
// object built key by key. Setting an existing key keeps its position.
type Object struct {
	keys []string
	vals map[string]any
}

// NewObject returns an empty ordered object.
func NewObject() *Object { return &Object{vals: map[string]any{}} }

// Set adds or replaces a key.
func (o *Object) Set(k string, v any) *Object {
	if _, ok := o.vals[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.vals[k] = v
	return o
}

// Get returns a value.
func (o *Object) Get(k string) (any, bool) { v, ok := o.vals[k]; return v, ok }

// Len is the number of keys.
func (o *Object) Len() int { return len(o.keys) }

// Keys returns the keys in insertion order.
func (o *Object) Keys() []string { return append([]string{}, o.keys...) }

// MarshalJSON writes keys in insertion order.
func (o *Object) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := Marshal(o.vals[k])
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// O builds an ordered object from alternating keys and values:
// O("a", 1, "b", 2) is {"a":1,"b":2} in that order.
func O(pairs ...any) *Object {
	o := NewObject()
	for i := 0; i+1 < len(pairs); i += 2 {
		o.Set(pairs[i].(string), pairs[i+1])
	}
	return o
}
