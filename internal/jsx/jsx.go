// Package jsx reproduces JavaScript string and number semantics that the
// ported code depends on: UTF-16 lengths and slices, String.prototype.trim,
// 32-bit integer arithmetic, Math.round.
package jsx

import (
	"math"
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

// Round is Math.round: halves round towards +Infinity.
func Round(f float64) float64 { return math.Floor(f + 0.5) }

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
		t := Trim(x)
		if t == "" {
			return 0
		}
		f, err := strconv.ParseFloat(t, 64)
		if err != nil || strings.ContainsAny(strings.ToLower(t), "inf_x") {
			return math.NaN()
		}
		return f
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
