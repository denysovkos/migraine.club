package zod

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

// ---------- string ----------

type stringCheck struct {
	// transform, when set, rewrites the value (trim, toLowerCase, ...).
	transform func(string) string
	// check returns a non-nil issue (without path/message) and its default
	// message when the value fails.
	check func(string) (Issue, string, bool)
	msg   string
}

// StringSchema is z.string().
type StringSchema struct {
	checks []stringCheck
}

// String is z.string().
func String() *StringSchema { return &StringSchema{} }

func (s *StringSchema) add(c stringCheck) *StringSchema {
	out := &StringSchema{checks: append(append([]stringCheck{}, s.checks...), c)}
	return out
}

func msgOr(custom []string, def string) string {
	if len(custom) > 0 && custom[0] != "" {
		return custom[0]
	}
	return def
}

// jsLen is String.prototype.length: UTF-16 code units.
func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

func (s *StringSchema) Min(n int, msg ...string) *StringSchema {
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		if jsLen(v) >= n {
			return Issue{}, "", true
		}
		return newIssue("origin", "string", "code", "too_small", "minimum", float64(n), "inclusive", true),
			fmt.Sprintf("Too small: expected string to have >=%d characters", n), false
	}})
}

func (s *StringSchema) Max(n int, msg ...string) *StringSchema {
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		if jsLen(v) <= n {
			return Issue{}, "", true
		}
		return newIssue("origin", "string", "code", "too_big", "maximum", float64(n), "inclusive", true),
			fmt.Sprintf("Too big: expected string to have <=%d characters", n), false
	}})
}

func (s *StringSchema) Length(n int, msg ...string) *StringSchema {
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		l := jsLen(v)
		if l == n {
			return Issue{}, "", true
		}
		if l < n {
			return newIssue("origin", "string", "code", "too_small", "minimum", float64(n), "inclusive", true, "exact", true),
				fmt.Sprintf("Too small: expected string to have exactly %d characters", n), false
		}
		return newIssue("origin", "string", "code", "too_big", "maximum", float64(n), "inclusive", true, "exact", true),
			fmt.Sprintf("Too big: expected string to have exactly %d characters", n), false
	}})
}

// formatCheck builds an invalid_format check backed by a regular expression
// whose JavaScript source is jsPattern.
func (s *StringSchema) formatCheck(format, jsPattern string, re *regexp.Regexp, label string, msg []string) *StringSchema {
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		if re.MatchString(v) {
			return Issue{}, "", true
		}
		return newIssue("origin", "string", "code", "invalid_format", "format", format, "pattern", jsPattern),
			"Invalid " + label, false
	}})
}

// Regex is .regex(re). jsSource is the JavaScript literal source without
// slashes (Zod reports it in `pattern`); flags are not supported.
func (s *StringSchema) Regex(jsSource string, msg ...string) *StringSchema {
	re := regexp.MustCompile(jsSource)
	pattern := "/" + jsSource + "/"
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		if re.MatchString(v) {
			return Issue{}, "", true
		}
		return newIssue("origin", "string", "code", "invalid_format", "format", "regex", "pattern", pattern),
			"Invalid string: must match pattern " + pattern, false
	}})
}

const (
	uuidSrc  = `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`
	guidSrc  = `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$`
	emailSrc = `^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`
	dateSrc  = `(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))`
	dtUTC    = `^` + dateSrc + `T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$`
	dtOffset = `^` + dateSrc + `T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$`
)

var (
	uuidRe     = regexp.MustCompile(uuidSrc)
	guidRe     = regexp.MustCompile(guidSrc)
	emailRe    = regexp.MustCompile(emailSrc)
	dtUTCRe    = regexp.MustCompile(dtUTC)
	dtOffsetRe = regexp.MustCompile(dtOffset)
)

// UUID is .uuid() (RFC 9562 variants 1-8 plus nil and max).
func (s *StringSchema) UUID(msg ...string) *StringSchema {
	return s.formatCheck("uuid", "/"+uuidSrc+"/", uuidRe, "UUID", msg)
}

// GUID is .guid(): any 8-4-4-4-12 hex string.
func (s *StringSchema) GUID(msg ...string) *StringSchema {
	return s.formatCheck("guid", "/"+guidSrc+"/", guidRe, "GUID", msg)
}

// Email is .email().
func (s *StringSchema) Email(msg ...string) *StringSchema {
	return s.formatCheck("email", "/"+emailSrc+"/", emailRe, "email address", msg)
}

// Datetime is .datetime(): ISO 8601 in UTC ("Z"), optional fractional seconds.
func (s *StringSchema) Datetime(msg ...string) *StringSchema {
	return s.formatCheck("datetime", "/"+dtUTC+"/", dtUTCRe, "ISO datetime", msg)
}

// DatetimeOffset is .datetime({ offset: true }).
func (s *StringSchema) DatetimeOffset(msg ...string) *StringSchema {
	return s.formatCheck("datetime", "/"+dtOffset+"/", dtOffsetRe, "ISO datetime", msg)
}

// URL is .url(): anything `new URL()` accepts with a hostname. Zod reports no
// origin or pattern for it.
func (s *StringSchema) URL(msg ...string) *StringSchema {
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		u, err := url.Parse(v)
		if err == nil && u.Scheme != "" && u.Host != "" {
			return Issue{}, "", true
		}
		return newIssue("code", "invalid_format", "format", "url"), "Invalid URL", false
	}})
}

func (s *StringSchema) StartsWith(prefix string, msg ...string) *StringSchema {
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		if strings.HasPrefix(v, prefix) {
			return Issue{}, "", true
		}
		return newIssue("origin", "string", "code", "invalid_format", "format", "starts_with", "prefix", prefix),
			`Invalid string: must start with "` + prefix + `"`, false
	}})
}

func (s *StringSchema) EndsWith(suffix string, msg ...string) *StringSchema {
	return s.add(stringCheck{msg: msgOr(msg, ""), check: func(v string) (Issue, string, bool) {
		if strings.HasSuffix(v, suffix) {
			return Issue{}, "", true
		}
		return newIssue("origin", "string", "code", "invalid_format", "format", "ends_with", "suffix", suffix),
			`Invalid string: must end with "` + suffix + `"`, false
	}})
}

// Trim is .trim(): String.prototype.trim.
func (s *StringSchema) Trim() *StringSchema {
	return s.add(stringCheck{transform: jsTrim})
}

func (s *StringSchema) ToLowerCase() *StringSchema {
	return s.add(stringCheck{transform: strings.ToLower})
}

func (s *StringSchema) ToUpperCase() *StringSchema {
	return s.add(stringCheck{transform: strings.ToUpper})
}

// jsTrim removes the characters String.prototype.trim removes.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
			return true
		}
		return r >= 0x2000 && r <= 0x200a
	})
}

func (s *StringSchema) run(v any, path []any) (any, []Issue) {
	str, ok := v.(string)
	if !ok {
		return nil, []Issue{invalidType("string", v, path)}
	}
	var issues []Issue
	for _, c := range s.checks {
		if c.transform != nil {
			str = c.transform(str)
			continue
		}
		if is, def, ok := c.check(str); !ok {
			msg := def
			if c.msg != "" {
				msg = c.msg
			}
			issues = append(issues, is.finish(path, msg))
		}
	}
	if len(issues) > 0 {
		return nil, issues
	}
	return str, nil
}

// ---------- number ----------

type numberCheck struct {
	check func(float64) (Issue, string, bool)
	msg   string
}

// NumberSchema is z.number() (or z.coerce.number()).
type NumberSchema struct {
	coerce bool
	checks []numberCheck
}

// Number is z.number().
func Number() *NumberSchema { return &NumberSchema{} }

// CoerceNumber is z.coerce.number(): Number(input) first.
func CoerceNumber() *NumberSchema { return &NumberSchema{coerce: true} }

func (n *NumberSchema) add(c numberCheck) *NumberSchema {
	return &NumberSchema{coerce: n.coerce, checks: append(append([]numberCheck{}, n.checks...), c)}
}

func bound(kind string, limit float64, inclusive bool) func(float64) (Issue, string, bool) {
	return func(v float64) (Issue, string, bool) {
		switch kind {
		case "min":
			if (inclusive && v >= limit) || (!inclusive && v > limit) {
				return Issue{}, "", true
			}
			adj := ">"
			if inclusive {
				adj = ">="
			}
			return newIssue("origin", "number", "code", "too_small", "minimum", limit, "inclusive", inclusive),
				"Too small: expected number to be " + adj + jsNumber(limit), false
		default:
			if (inclusive && v <= limit) || (!inclusive && v < limit) {
				return Issue{}, "", true
			}
			adj := "<"
			if inclusive {
				adj = "<="
			}
			return newIssue("origin", "number", "code", "too_big", "maximum", limit, "inclusive", inclusive),
				"Too big: expected number to be " + adj + jsNumber(limit), false
		}
	}
}

func (n *NumberSchema) Min(v float64, msg ...string) *NumberSchema {
	return n.add(numberCheck{check: bound("min", v, true), msg: msgOr(msg, "")})
}
func (n *NumberSchema) Max(v float64, msg ...string) *NumberSchema {
	return n.add(numberCheck{check: bound("max", v, true), msg: msgOr(msg, "")})
}
func (n *NumberSchema) Gt(v float64, msg ...string) *NumberSchema {
	return n.add(numberCheck{check: bound("min", v, false), msg: msgOr(msg, "")})
}
func (n *NumberSchema) Lt(v float64, msg ...string) *NumberSchema {
	return n.add(numberCheck{check: bound("max", v, false), msg: msgOr(msg, "")})
}
func (n *NumberSchema) Positive(msg ...string) *NumberSchema    { return n.Gt(0, msg...) }
func (n *NumberSchema) Nonnegative(msg ...string) *NumberSchema { return n.Min(0, msg...) }

const maxSafeInt = 9007199254740991

// Int is .int(): a safe integer.
func (n *NumberSchema) Int(msg ...string) *NumberSchema {
	return n.add(numberCheck{msg: msgOr(msg, ""), check: func(v float64) (Issue, string, bool) {
		if v != math.Trunc(v) {
			return newIssue("expected", "int", "format", "safeint", "code", "invalid_type"),
				"Invalid input: expected int, received number", false
		}
		if v > maxSafeInt {
			return newIssue("code", "too_big", "maximum", float64(maxSafeInt), "note", "Integers must be within the safe integer range.", "origin", "int", "inclusive", true),
				"Too big: expected int to be <=9007199254740991", false
		}
		if v < -maxSafeInt {
			return newIssue("code", "too_small", "minimum", float64(-maxSafeInt), "note", "Integers must be within the safe integer range.", "origin", "int", "inclusive", true),
				"Too small: expected int to be >=-9007199254740991", false
		}
		return Issue{}, "", true
	}})
}

// jsToNumber is Number(value) for decoded JSON values.
func jsToNumber(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		t := jsTrim(x)
		if t == "" {
			return 0
		}
		switch t {
		case "Infinity", "+Infinity":
			return math.Inf(1)
		case "-Infinity":
			return math.Inf(-1)
		}
		lower := strings.ToLower(t)
		if strings.HasPrefix(lower, "0x") {
			if n, err := strconv.ParseUint(t[2:], 16, 64); err == nil {
				return float64(n)
			}
			return math.NaN()
		}
		if strings.ContainsAny(lower, "inf") || strings.Contains(lower, "_") {
			return math.NaN()
		}
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	default:
		return math.NaN()
	}
}

func (n *NumberSchema) run(v any, path []any) (any, []Issue) {
	if n.coerce {
		v = jsToNumber(v)
	}
	f, ok := v.(float64)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		return nil, []Issue{invalidType("number", v, path)}
	}
	var issues []Issue
	for _, c := range n.checks {
		if is, def, ok := c.check(f); !ok {
			msg := def
			if c.msg != "" {
				msg = c.msg
			}
			issues = append(issues, is.finish(path, msg))
		}
	}
	if len(issues) > 0 {
		return nil, issues
	}
	return f, nil
}

// ---------- boolean ----------

type boolSchema struct{ coerce bool }

// Boolean is z.boolean().
func Boolean() Schema { return boolSchema{} }

// CoerceBoolean is z.coerce.boolean(): Boolean(input).
func CoerceBoolean() Schema { return boolSchema{coerce: true} }

func (b boolSchema) run(v any, path []any) (any, []Issue) {
	if b.coerce {
		switch x := v.(type) {
		case bool:
			return x, nil
		case string:
			return x != "", nil
		case float64:
			return x != 0 && !math.IsNaN(x), nil
		case nil, undefinedT:
			return false, nil
		default:
			return true, nil
		}
	}
	x, ok := v.(bool)
	if !ok {
		return nil, []Issue{invalidType("boolean", v, path)}
	}
	return x, nil
}

// ---------- enum / literal ----------

type enumSchema struct {
	values []any
	msg    string
}

// Enum is z.enum([...]) and z.nativeEnum(obj) over string values.
func Enum(values ...string) Schema {
	vs := make([]any, len(values))
	for i, v := range values {
		vs[i] = v
	}
	return enumSchema{values: vs}
}

// EnumMsg is Enum with a custom error message.
func EnumMsg(msg string, values ...string) Schema {
	e := Enum(values...).(enumSchema)
	e.msg = msg
	return e
}

// Literal is z.literal(v) for a string, number or boolean.
func Literal(v any) Schema {
	if i, ok := v.(int); ok {
		v = float64(i)
	}
	return enumSchema{values: []any{v}}
}

func (e enumSchema) run(v any, path []any) (any, []Issue) {
	for _, allowed := range e.values {
		if allowed == v {
			return v, nil
		}
	}
	msg := e.msg
	if msg == "" {
		if len(e.values) == 1 {
			msg = "Invalid input: expected " + stringifyPrimitive(e.values[0])
		} else {
			msg = "Invalid option: expected one of " + joinValues(e.values, "|")
		}
	}
	return nil, []Issue{newIssue("code", "invalid_value", "values", e.values).finish(path, msg)}
}

// ---------- null / unknown ----------

type nullSchema struct{}

// Null is z.null().
func Null() Schema { return nullSchema{} }

func (nullSchema) run(v any, path []any) (any, []Issue) {
	if v == nil {
		return nil, nil
	}
	return nil, []Issue{invalidType("null", v, path)}
}

type unknownSchema struct{}

// Unknown is z.unknown(). Inside an object a missing key is reported as
// "expected nonoptional", as Zod 4.6 does.
func Unknown() Schema { return unknownSchema{} }

func (unknownSchema) run(v any, path []any) (any, []Issue) {
	if _, undef := v.(undefinedT); undef {
		return nil, []Issue{newIssue("code", "invalid_type", "expected", "nonoptional").
			finish(path, "Invalid input: expected nonoptional, received undefined")}
	}
	return v, nil
}
