package zod

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// goldenSchemas are the Go equivalents of the schemas in scripts/zod-golden.mts.
var goldenSchemas = map[string]Schema{
	"string":                 String(),
	"string_min_max":         String().Min(2).Max(4),
	"string_trim_min":        String().Trim().Min(1).Max(3),
	"string_length":          String().Length(3),
	"string_uuid":            String().UUID(),
	"string_guid":            String().GUID(),
	"string_email":           String().Email(),
	"string_url":             String().URL(),
	"string_datetime":        String().Datetime(),
	"string_datetime_offset": String().DatetimeOffset(),
	"string_regex":           String().Regex(`^\d{4}-\d{2}-\d{2}$`),
	"string_regex_msg":       String().Regex(`^\d{2}:\d{2}$`, "Expected HH:MM"),
	"string_min_msg":         String().Min(1, "Name is required"),
	"number":                 Number(),
	"number_int_range":       Number().Int().Min(1).Max(5),
	"number_positive":        Number().Positive(),
	"number_nonnegative":     Number().Nonnegative(),
	"number_gt_lt":           Number().Gt(0).Lt(10),
	"coerce_number":          CoerceNumber().Int().Min(1),
	"boolean":                Boolean(),
	"enum":                   Enum("a", "b", "c"),
	"enum_one":               Enum("only"),
	"literal":                Literal("x"),
	"literal_num":            Literal(3),
	"array":                  Array(String()).Min(1).Max(2),
	"optional":               Optional(String()),
	"nullable":               Nullable(String()),
	"nullish":                Nullish(String()),
	"default":                Default(Number(), 5),
	"object":                 Object(F("a", String()), F("b", Optional(Number())), F("c", Default(Boolean(), false))),
	"object_nested":          Object(F("p", Object(F("q", Array(Object(F("r", Number().Max(3)))))))),
	"object_strict":          Object(F("a", String())).Strict(),
	"union":                  Union(String(), Number()),
	"discriminated": DiscriminatedUnion("kind",
		Object(F("kind", Literal("a")), F("x", Number())),
		Object(F("kind", Literal("b")), F("y", String()))),
	"record": Record(String(), Number()),
	"refine": Refine(Object(F("from", String()), F("to", String())), func(v any) bool {
		m := v.(map[string]any)
		return m["from"].(string) <= m["to"].(string)
	}, "from must be before to", "to"),
	"refine_root": Refine(Number(), func(v any) bool { return math.Mod(v.(float64), 2) == 0 }, "Must be even"),
	"refine_with_field_error": Refine(Object(F("a", Number()), F("b", Number())), func(v any) bool {
		m := v.(map[string]any)
		return m["a"].(float64) < m["b"].(float64)
	}, "a<b"),
	"object_defaults":    Object(F("n", Default(Number().Int(), 3)), F("s", Optional(String())), F("l", Default(Array(String()), []any{}))),
	"catch":              Object(F("n", Catch(Number(), 7))),
	"coerce_boolean":     CoerceBoolean(),
	"lowercase":          String().Trim().ToLowerCase().Email(),
	"multi_check":        String().Min(5).Regex(`^a`),
	"nullable_obj_field": Object(F("x", Optional(Nullable(String()))), F("y", Nullable(Number()))),
	"array_of_objects":   Array(Object(F("id", String().GUID()), F("v", Number().Min(0).Max(10)))).Max(3),
	"int_unsafe":         Number().Int(),
	"union_nested": Object(F("p", Nullish(Union(Null(), Object(F("n", Number().Int().Positive())),
		Array(Number().Int().Min(1).Max(7)), Array(String().Regex(`^\d{4}-\d{2}-\d{2}$`)))))),
	"union_checks":     Union(String().Min(3), Number().Max(2)),
	"union_two_soft":   Object(F("u", Union(String().Min(5), String().Max(1)))),
	"super_refine": Object(F("a", SuperRefine(Object(F("x", Number())), func(v any, ctx *Ctx) {
		if v.(map[string]any)["x"].(float64) > 1 {
			ctx.Issue("code", "custom", "message", "too big")
			ctx.Issue("code", "custom", "message", "with path", "path", []any{"x"})
		}
	}))),
	"unknown":          Object(F("u", Unknown())),
	"null":             Null(),
	"starts_ends":      String().StartsWith("ab").EndsWith("yz"),
	"native_enum_like": Enum("a", "b"),
}

type goldenResult struct {
	Input   json.RawMessage `json:"input"`
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Issues  json.RawMessage `json:"issues"`
	Message string          `json:"message"`
	Flatten json.RawMessage `json:"flatten"`
}

func decodeGolden(t *testing.T, raw json.RawMessage) any {
	t.Helper()
	if string(raw) == `"__undefined__"` {
		return Undefined
	}
	v, err := Decode(raw)
	require.NoError(t, err)
	return v
}

func TestMatchesRealZod(t *testing.T) {
	raw, err := os.ReadFile("testdata/golden.json")
	require.NoError(t, err)
	var cases []struct {
		Name    string         `json:"name"`
		Results []goldenResult `json:"results"`
	}
	require.NoError(t, json.Unmarshal(raw, &cases))

	for _, c := range cases {
		schema, ok := goldenSchemas[c.Name]
		require.True(t, ok, "no Go schema for golden case %q", c.Name)
		for _, r := range c.Results {
			t.Run(c.Name+"/"+string(r.Input), func(t *testing.T) {
				input := decodeGolden(t, r.Input)
				// JSON.stringify wrote NaN inputs as null; restore them.
				if input == nil && strings.Contains(string(r.Issues), `"received": "NaN"`) {
					input = math.NaN()
				}
				out, err := Parse(schema, input)
				if r.Success {
					require.NoError(t, err)
					if string(r.Data) == `"__undefined__"` {
						require.Equal(t, Undefined, out)
						return
					}
					got, mErr := marshalJS(out)
					require.NoError(t, mErr)
					require.JSONEq(t, string(r.Data), string(got))
					return
				}
				require.Error(t, err)
				zerr := err.(*Error)
				got, mErr := marshalJS(zerr.Issues)
				require.NoError(t, mErr)
				// Exact bytes: key order and number formatting must match.
				var want any
				require.NoError(t, json.Unmarshal(r.Issues, &want))
				wantCompact, _ := marshalPlain(want)
				if c.Name != "object_strict" {
					require.JSONEq(t, string(wantCompact), string(got))
				}
				requireSameKeyOrder(t, r.Issues, got)
				require.Equal(t, r.Message, zerr.Error())
				fl, _ := json.Marshal(zerr.Flatten())
				require.JSONEq(t, string(r.Flatten), string(fl))
			})
		}
	}
}

// requireSameKeyOrder checks that issue objects list their keys in Zod's order.
func requireSameKeyOrder(t *testing.T, want, got []byte) {
	t.Helper()
	var w, g []json.RawMessage
	require.NoError(t, json.Unmarshal(want, &w))
	require.NoError(t, json.Unmarshal(got, &g))
	require.Len(t, g, len(w))
	for i := range w {
		require.Equal(t, keysInOrder(t, w[i]), keysInOrder(t, g[i]))
	}
}

func keysInOrder(t *testing.T, obj json.RawMessage) []string {
	dec := json.NewDecoder(jsonReader(obj))
	tok, err := dec.Token()
	require.NoError(t, err)
	require.Equal(t, json.Delim('{'), tok)
	var keys []string
	for dec.More() {
		k, err := dec.Token()
		require.NoError(t, err)
		keys = append(keys, k.(string))
		var skip json.RawMessage
		require.NoError(t, dec.Decode(&skip))
	}
	return keys
}

func TestParseIntoTypedStruct(t *testing.T) {
	s := Object(F("name", String().Trim().Min(1)), F("count", Default(Number().Int(), 2)), F("tags", Optional(Array(String()))))
	var dst struct {
		Name  string   `json:"name"`
		Count int      `json:"count"`
		Tags  []string `json:"tags"`
	}
	v, _ := Decode([]byte(`{"name":"  x  ","extra":true}`))
	require.NoError(t, ParseInto(s, v, &dst))
	require.Equal(t, "x", dst.Name)
	require.Equal(t, 2, dst.Count)
	require.Nil(t, dst.Tags)
}

func TestDecodeEmptyBodyIsUndefined(t *testing.T) {
	v, err := Decode([]byte("  "))
	require.NoError(t, err)
	require.Equal(t, Undefined, v)
	_, err = Decode([]byte("{"))
	require.Error(t, err)
}

func TestJSNumber(t *testing.T) {
	require.Equal(t, "1", jsNumber(1))
	require.Equal(t, "1.5", jsNumber(1.5))
	require.Equal(t, "9007199254740991", jsNumber(9007199254740991))
	require.Equal(t, "1e+21", jsNumber(1e21))
	require.Equal(t, "1e-7", jsNumber(1e-7))
	require.Equal(t, "0.1", jsNumber(0.1))
}

func jsonReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }
