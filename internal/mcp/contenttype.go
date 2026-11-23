package mcp

import (
	"encoding/base64"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

func isTokenChar(c byte) bool {
	switch {
	case c >= '0' && c <= '9', c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
		return true
	}
	return strings.IndexByte("!#$%&'*+.^_`|~-", c) >= 0
}

func token(s string, i int) int {
	j := i
	for j < len(s) && isTokenChar(s[j]) {
		j++
	}
	return j
}

func spaces(s string, i int) int {
	for i < len(s) && s[i] == ' ' {
		i++
	}
	return i
}

// param matches the content-type package's PARAM_REGEXP at i and returns
// the end of the match, or -1.
func param(s string, i int) int {
	if i >= len(s) || s[i] != ';' {
		return -1
	}
	i = spaces(s, i+1)
	j := token(s, i)
	if j == i {
		return -1
	}
	i = spaces(s, j)
	if i >= len(s) || s[i] != '=' {
		return -1
	}
	i = spaces(s, i+1)
	if i < len(s) && s[i] == '"' {
		k := i + 1
		for k < len(s) {
			c := s[k]
			if c == '"' {
				break
			}
			if c == '\\' {
				if k+1 < len(s) && (s[k+1] == 0x0b || s[k+1] >= 0x20) {
					k += 2
					continue
				}
				return -1
			}
			if c == 0x0b || c == 0x20 || c == 0x21 || (c >= 0x23 && c <= 0x5b) || (c >= 0x5d && c <= 0x7e) || c >= 0x80 {
				k++
				continue
			}
			return -1
		}
		if k >= len(s) {
			return -1
		}
		return spaces(s, k+1)
	}
	j = token(s, i)
	if j == i {
		return -1
	}
	return spaces(s, j)
}

var typeRe = regexp.MustCompile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+/[!#$%&'*+.^_`|~0-9A-Za-z-]+$")

// parseMediaType is contentType.parse(header).type; ok is false where it threw.
func parseMediaType(header string) (string, bool) {
	if header == "" {
		return "", false
	}
	index := strings.IndexByte(header, ';')
	typ := header
	if index >= 0 {
		typ = header[:index]
	}
	typ = jsx.Trim(typ)
	if !typeRe.MatchString(typ) {
		return "", false
	}
	if index >= 0 {
		for index < len(header) {
			end := param(header, index)
			if end < 0 {
				return "", false
			}
			index = end
		}
	}
	return strings.ToLower(typ), true
}

// mediaTypeEssence is the SDK's mediaTypeEssence; ok is false for undefined.
func mediaTypeEssence(header string, present bool) (string, bool) {
	if !present || header == "" {
		return "", false
	}
	if t, ok := parseMediaType(header); ok {
		return t, true
	}
	first, _, _ := strings.Cut(header, ";")
	essence := strings.ToLower(jsx.Trim(first))
	if essence == "" || strings.Contains(sliceUnits(header, utf16Units(essence)), ",") {
		return "", false
	}
	return essence, true
}

func utf16Units(s string) int { return len([]rune(s)) + extraUnits(s) }

func extraUnits(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xFFFF {
			n++
		}
	}
	return n
}

func sliceUnits(s string, from int) string { return jsx.SliceUTF16(s, from, utf16Units(s)) }

// isJSONContentType is the SDK's isJsonContentType.
func isJSONContentType(header string, present bool) bool {
	if present && header == "application/json" {
		return true
	}
	t, ok := mediaTypeEssence(header, present)
	return ok && t == "application/json"
}

var base64Canonical = regexp.MustCompile(`^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`)

// decodeParamValue is decodeMcpParamValue; ok is false for undefined.
func decodeParamValue(v string) (string, bool) {
	const prefix, suffix = "=?base64?", "?="
	if !strings.HasPrefix(v, prefix) || !strings.HasSuffix(v, suffix) {
		return v, true
	}
	b64 := jsx.SliceUTF16(v, 9, utf16Units(v)-2)
	if !base64Canonical.MatchString(b64) {
		return "", false
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || !utf8.Valid(raw) {
		return "", false
	}
	return strings.TrimPrefix(string(raw), "\xef\xbb\xbf"), true
}
