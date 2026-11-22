// Package jsx reproduces JavaScript string and number semantics that the
// ported code depends on: UTF-16 lengths and slices, String.prototype.trim,
// 32-bit integer arithmetic, Math.round.
package jsx

import (
	"math"
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
