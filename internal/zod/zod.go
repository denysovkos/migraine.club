// Package zod is a small Go port of the parts of Zod v4 the API used for
// request validation.
//
// The Node handlers answered invalid input with Zod's issues (and a few even
// put ZodError.message into the response), so the port reproduces Zod's issue
// objects, their key order and their English messages exactly. It is tested
// against testdata/golden.json, which scripts/zod-golden.mts generates from the
// real library.
//
// Input is a decoded JSON tree (see Decode). Parsing returns a cleaned tree:
// unknown object keys stripped, defaults applied, transforms run. Decode that
// tree into a typed struct with Into.
package zod

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Undefined marks a missing value (an absent object key or no body at all).
type undefinedT struct{}

// Undefined is the value of a missing key.
var Undefined = undefinedT{}

// Issue is one Zod issue. Fields keep Zod's key order when marshalled.
type Issue struct {
	fields []kv
}

type kv struct {
	k string
	v any
}

func newIssue(pairs ...any) Issue {
	is := Issue{}
	for i := 0; i < len(pairs); i += 2 {
		is.fields = append(is.fields, kv{pairs[i].(string), pairs[i+1]})
	}
	return is
}

// Get returns a field of the issue.
func (is Issue) Get(key string) any {
	for _, f := range is.fields {
		if f.k == key {
			return f.v
		}
	}
	return nil
}

// Code is the issue code ("invalid_type", "too_small", ...).
func (is Issue) Code() string { s, _ := is.Get("code").(string); return s }

// Message is the issue message.
func (is Issue) Message() string { s, _ := is.Get("message").(string); return s }

// Path is the issue path.
func (is Issue) Path() []any { p, _ := is.Get("path").([]any); return p }

// withPath inserts "path" and "message" at the end, in Zod's order.
func (is Issue) finish(path []any, message string) Issue {
	is.fields = append(is.fields, kv{"path", path}, kv{"message", message})
	return is
}

func (is Issue) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, f := range is.fields {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(f.k)
		b.Write(k)
		b.WriteByte(':')
		v, err := marshalJS(f.v)
		if err != nil {
			return nil, err
		}
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// Error is a failed parse, like ZodError.
type Error struct {
	Issues []Issue
}

// Error returns ZodError.message: the issues as JSON indented by two spaces.
func (e *Error) Error() string {
	raw, _ := marshalJS(e.Issues)
	var out bytes.Buffer
	_ = json.Indent(&out, raw, "", "  ")
	return out.String()
}

// Flatten is z.flattenError(error) (and error.flatten()).
type Flatten struct {
	FormErrors  []string    `json:"formErrors"`
	FieldErrors FieldErrors `json:"fieldErrors"`
}

// FieldErrors maps a top-level key to its messages, keeping the order in
// which keys first appear, as the JavaScript object did.
type FieldErrors struct {
	keys []string
	msgs map[string][]string
}

// Get returns the messages for a key.
func (f FieldErrors) Get(key string) []string { return f.msgs[key] }

// Keys returns the keys in order.
func (f FieldErrors) Keys() []string { return append([]string{}, f.keys...) }

func (f FieldErrors) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range f.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := marshalPlain(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, _ := marshalPlain(f.msgs[k])
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// Flatten groups messages by their first path segment.
func (e *Error) Flatten() Flatten {
	f := Flatten{FormErrors: []string{}, FieldErrors: FieldErrors{msgs: map[string][]string{}}}
	for _, is := range e.Issues {
		p := is.Path()
		if len(p) == 0 {
			f.FormErrors = append(f.FormErrors, is.Message())
			continue
		}
		key := fmt.Sprint(p[0])
		if _, seen := f.FieldErrors.msgs[key]; !seen {
			f.FieldErrors.keys = append(f.FieldErrors.keys, key)
		}
		f.FieldErrors.msgs[key] = append(f.FieldErrors.msgs[key], is.Message())
	}
	return f
}

// Schema validates and transforms one value.
type Schema interface {
	run(v any, path []any) (any, []Issue)
}

// Parse runs the schema. The error, when not nil, is an *Error.
func Parse(s Schema, v any) (any, error) {
	out, issues := s.run(v, []any{})
	if len(issues) > 0 {
		return nil, &Error{Issues: issues}
	}
	return out, nil
}

// ParseInto parses v and decodes the cleaned result into dst.
func ParseInto(s Schema, v any, dst any) error {
	out, err := Parse(s, v)
	if err != nil {
		return err
	}
	return Into(out, dst)
}

// Into decodes a parsed tree into a typed value.
func Into(parsed any, dst any) error {
	b, err := marshalJS(parsed)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, dst)
}

// Decode turns a JSON document into the tree the schemas read: objects are
// map[string]any, arrays []any, numbers float64. An empty body is Undefined.
func Decode(raw []byte) (any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return Undefined, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return v, nil
}

func pathWith(path []any, seg any) []any {
	out := make([]any, len(path)+1)
	copy(out, path)
	out[len(path)] = seg
	return out
}

// parsedType is Zod's util.parsedType for decoded JSON values.
func parsedType(v any) string {
	switch x := v.(type) {
	case undefinedT:
		return "undefined"
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		if math.IsNaN(x) {
			return "NaN"
		}
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return "object"
	}
}

func invalidType(expected string, v any, path []any) Issue {
	received := parsedType(v)
	is := newIssue("expected", expected, "code", "invalid_type")
	if f, ok := v.(float64); ok && math.IsNaN(f) {
		is.fields = append(is.fields, kv{"received", "NaN"})
	}
	return is.finish(path, fmt.Sprintf("Invalid input: expected %s, received %s", expected, received))
}

// jsNumber formats a number like JavaScript's String(n).
func jsNumber(f float64) string {
	if math.IsInf(f, 1) {
		return "Infinity"
	}
	if math.IsInf(f, -1) {
		return "-Infinity"
	}
	if math.IsNaN(f) {
		return "NaN"
	}
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	s := strconv.FormatFloat(f, 'g', -1, 64)
	// Go writes 1e+21 like JS does, but pads exponents differently (1e-07).
	if i := strings.Index(s, "e"); i >= 0 {
		mant, exp := s[:i], s[i+1:]
		sign := exp[0]
		digits := strings.TrimLeft(exp[1:], "0")
		s = mant + "e" + string(sign) + digits
	}
	return s
}

// marshalJS encodes like JSON.stringify: no HTML escaping, no trailing
// newline, numbers as JavaScript prints them.
func marshalJS(v any) ([]byte, error) {
	switch x := v.(type) {
	case float64:
		return []byte(jsNumber(x)), nil
	case undefinedT:
		return []byte("null"), nil
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k, val := range x {
			if _, undef := val.(undefinedT); undef {
				continue
			}
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var b bytes.Buffer
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			kb, _ := marshalPlain(k)
			b.Write(kb)
			b.WriteByte(':')
			vb, err := marshalJS(x[k])
			if err != nil {
				return nil, err
			}
			b.Write(vb)
		}
		b.WriteByte('}')
		return b.Bytes(), nil
	case []any:
		var b bytes.Buffer
		b.WriteByte('[')
		for i, el := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			vb, err := marshalJS(el)
			if err != nil {
				return nil, err
			}
			b.Write(vb)
		}
		b.WriteByte(']')
		return b.Bytes(), nil
	case []string:
		arr := make([]any, len(x))
		for i, s := range x {
			arr[i] = s
		}
		return marshalJS(arr)
	case []Issue:
		var b bytes.Buffer
		b.WriteByte('[')
		for i, el := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			vb, err := el.MarshalJSON()
			if err != nil {
				return nil, err
			}
			b.Write(vb)
		}
		b.WriteByte(']')
		return b.Bytes(), nil
	case [][]Issue:
		var b bytes.Buffer
		b.WriteByte('[')
		for i, el := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			vb, err := marshalJS(el)
			if err != nil {
				return nil, err
			}
			b.Write(vb)
		}
		b.WriteByte(']')
		return b.Bytes(), nil
	default:
		return marshalPlain(v)
	}
}

func marshalPlain(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

// stringifyPrimitive is util.stringifyPrimitive: strings quoted, others raw.
func stringifyPrimitive(v any) string {
	switch x := v.(type) {
	case string:
		return strconv.Quote(x)
	case float64:
		return jsNumber(x)
	default:
		return fmt.Sprint(x)
	}
}

func joinValues(values []any, sep string) string {
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = stringifyPrimitive(v)
	}
	return strings.Join(parts, sep)
}
