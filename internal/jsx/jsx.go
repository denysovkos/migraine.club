// Package jsx reproduces JavaScript string and number semantics that the
// ported code depends on: UTF-16 lengths and slices, String.prototype.trim,
// 32-bit integer arithmetic, Math.round.
package jsx

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Len is String.prototype.length.
func Len(s string) int { return len(utf16.Encode([]rune(s))) }

// Slice is String.prototype.slice(start, end) for non-negative indexes in
// UTF-16 code units. end < 0 means "to the end".
func Slice(s string, start, end int) string {
	u := utf16.Encode([]rune(s))
	if end < 0 || end > len(u) {
		end = len(u)
	}
	if start > end {
		return ""
	}
	return string(utf16.Decode(u[start:end]))
}

// Trim is String.prototype.trim.
func Trim(s string) string {
	return strings.TrimFunc(s, isJSSpace)
}

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// CharCodes returns the UTF-16 code units (charCodeAt for every index).
func CharCodes(s string) []uint16 { return utf16.Encode([]rune(s)) }

// ToInt32 is the ECMAScript ToInt32 conversion.
func ToInt32(f float64) int32 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return int32(uint32(int64(math.Trunc(math.Mod(f, 4294967296)))))
}

// Round is Math.round: halves round towards +Infinity. floor(f+0.5) is not
// enough: the addition itself rounds (0.49999999999999994 + 0.5 is 1, and
// odd integers above 2^52 gain one), and a negative input rounding to zero
// gives -0.
func Round(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) >= 1<<52 {
		return f
	}
	r := math.Floor(f)
	if f-r >= 0.5 {
		r++
	}
	if r == 0 && math.Signbit(f) {
		return math.Copysign(0, -1)
	}
	return r
}

// Mod is the % operator on numbers (sign follows the dividend).
func Mod(a, b float64) float64 { return math.Mod(a, b) }

// ParseFloat is Number.parseFloat: the longest numeric prefix after leading
// whitespace, NaN when there is none.
func ParseFloat(s string) float64 {
	s = strings.TrimLeftFunc(s, isJSSpace)
	if strings.HasPrefix(s, "Infinity") || strings.HasPrefix(s, "+Infinity") {
		return math.Inf(1)
	}
	if strings.HasPrefix(s, "-Infinity") {
		return math.Inf(-1)
	}
	end := 0
	seenDigit, seenDot, seenExp := false, false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			seenDigit = true
			end = i + 1
		case (c == '+' || c == '-') && (i == 0 || s[i-1] == 'e' || s[i-1] == 'E'):
		case c == '.' && !seenDot && !seenExp:
			seenDot = true
			if seenDigit {
				end = i + 1
			}
		case (c == 'e' || c == 'E') && seenDigit && !seenExp:
			seenExp = true
		default:
			i = len(s)
		}
	}
	if !seenDigit {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(strings.TrimRight(s[:end], "eE+-"), 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// ToNumber is Number(v) for decoded JSON values.
func ToNumber(v any) float64 {
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
		return StringToNumber(x)
	default:
		return math.NaN()
	}
}

// String is String(v) for decoded JSON values.
func String(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return "null"
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return FormatNumber(x)
	case []any:
		parts := make([]string, len(x))
		for i, el := range x {
			if el != nil {
				parts[i] = String(el)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// FormatNumber is Number.prototype.toString().
func FormatNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	if math.Abs(f) < 1e21 && math.Abs(f) >= 1e-6 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	s := strconv.FormatFloat(f, 'e', -1, 64)
	mant, exp, _ := strings.Cut(s, "e")
	sign := exp[0]
	digits := strings.TrimLeft(exp[1:], "0")
	return mant + "e" + string(sign) + digits
}

// CompareUTF16 orders strings like Array.prototype.sort's default comparator:
// by UTF-16 code units, not by UTF-8 bytes.
func CompareUTF16(a, b string) int {
	ua, ub := CharCodes(a), CharCodes(b)
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			if ua[i] < ub[i] {
				return -1
			}
			return 1
		}
	}
	return len(ua) - len(ub)
}

// CollapseSpace is s.replace(/\s+/g, repl) with JavaScript's \s, which also
// matches Unicode spaces that Go's \s does not.
func CollapseSpace(s, repl string) string {
	var b strings.Builder
	inRun := false
	for _, r := range s {
		if isJSSpace(r) {
			if !inRun {
				b.WriteString(repl)
				inRun = true
			}
			continue
		}
		inRun = false
		b.WriteRune(r)
	}
	return b.String()
}

var decimalLiteral = regexp.MustCompile(`^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$`)

// StringToNumber is Number(s) for a string: ECMAScript's StringNumericLiteral
// (whitespace-trimmed decimal, ±Infinity, unsigned 0x/0o/0b), NaN otherwise.
func StringToNumber(s string) float64 {
	t := Trim(s)
	switch t {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(t) > 2 && t[0] == '0' {
		base := 0
		switch t[1] {
		case 'x', 'X':
			base = 16
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			v := 0.0
			for _, c := range strings.ToLower(t[2:]) {
				d := strings.IndexRune("0123456789abcdef", c)
				if d < 0 || d >= base {
					return math.NaN()
				}
				v = v*float64(base) + float64(d)
			}
			return v
		}
	}
	if !decimalLiteral.MatchString(t) {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return math.NaN()
	}
	return f
}

// IsFinite is Number.isFinite for a number.
func IsFinite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// ParseIntNumber is Number.parseInt(s, 10) as a JS number: NaN when no
// digits lead, and digit runs beyond int64 still give their (rounded) value.
func ParseIntNumber(s string) float64 {
	s = Trim(s)
	i := 0
	neg := false
	if i < len(s) && (s[i] == '+' || s[i] == '-') {
		neg = s[i] == '-'
		i++
	}
	start := i
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == start {
		return math.NaN()
	}
	f, _ := strconv.ParseFloat(s[start:i], 64)
	if neg {
		return -f
	}
	return f
}

// SliceUTF16 is String.prototype.slice(start, end) in UTF-16 code units,
// keeping a surrogate the cut leaves alone as WTF-8 so JSString can write
// it the way JSON.stringify does. end < 0 means "to the end".
func SliceUTF16(s string, start, end int) string {
	u := utf16.Encode([]rune(s))
	if end < 0 || end > len(u) {
		end = len(u)
	}
	if start >= end {
		return ""
	}
	var b strings.Builder
	part := u[start:end]
	for i := 0; i < len(part); i++ {
		c := rune(part[i])
		if utf16.IsSurrogate(c) && c < 0xDC00 && i+1 < len(part) && part[i+1] >= 0xDC00 && part[i+1] < 0xE000 {
			b.WriteRune(utf16.DecodeRune(c, rune(part[i+1])))
			i++
			continue
		}
		if utf16.IsSurrogate(c) {
			b.Write([]byte{0xED, byte(0x80 | (c>>6)&0x3F), byte(0x80 | c&0x3F)})
			continue
		}
		b.WriteRune(c)
	}
	return b.String()
}

// JSString marshals like JSON.stringify(string), including lone surrogates
// left by SliceUTF16 (encoding/json would turn them into U+FFFD).
type JSString string

// MarshalJSON implements json.Marshaler.
func (s JSString) MarshalJSON() ([]byte, error) { return []byte(QuoteJSON(string(s))), nil }
