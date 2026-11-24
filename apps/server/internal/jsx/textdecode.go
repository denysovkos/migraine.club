package jsx

import (
	"errors"
	"strings"
	"unicode/utf8"
)

// UTF8Decode is TextDecoder('utf-8').decode(b): invalid sequences become one
// U+FFFD per maximal subpart (the WHATWG Encoding algorithm, not Go's one
// replacement per byte). stripBOM drops a leading BOM, as TextDecoder does
// unless ignoreBOM is set.
func UTF8Decode(b []byte, stripBOM bool) string {
	if stripBOM && len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		b = b[3:]
	}
	if utf8.Valid(b) {
		return string(b)
	}
	var out strings.Builder
	var cp rune
	needed, seen := 0, 0
	lower, upper := byte(0x80), byte(0xBF)
	for i := 0; i < len(b); {
		c := b[i]
		if needed == 0 {
			i++
			switch {
			case c <= 0x7F:
				out.WriteByte(c)
			case c >= 0xC2 && c <= 0xDF:
				needed, cp = 1, rune(c&0x1F)
			case c >= 0xE0 && c <= 0xEF:
				if c == 0xE0 {
					lower = 0xA0
				}
				if c == 0xED {
					upper = 0x9F
				}
				needed, cp = 2, rune(c&0x0F)
			case c >= 0xF0 && c <= 0xF4:
				if c == 0xF0 {
					lower = 0x90
				}
				if c == 0xF4 {
					upper = 0x8F
				}
				needed, cp = 3, rune(c&0x07)
			default:
				out.WriteRune(utf8.RuneError)
			}
			continue
		}
		if c < lower || c > upper {
			// The offending byte starts over; it is not consumed.
			cp, needed, seen, lower, upper = 0, 0, 0, 0x80, 0xBF
			out.WriteRune(utf8.RuneError)
			continue
		}
		lower, upper = 0x80, 0xBF
		cp = cp<<6 | rune(c&0x3F)
		seen++
		i++
		if seen == needed {
			out.WriteRune(cp)
			cp, needed, seen = 0, 0, 0
		}
	}
	if needed != 0 {
		out.WriteRune(utf8.RuneError)
	}
	return out.String()
}

// ErrURI is the URIError decodeURIComponent throws.
var ErrURI = errors.New("URIError: URI malformed")

func unhex(c byte) (byte, bool) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', true
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, true
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
}

// DecodeURIComponent is decodeURIComponent (ECMAScript Decode): every %XX
// is decoded, multi-byte runs must be well-formed UTF-8 escapes, anything
// else fails with ErrURI.
func DecodeURIComponent(s string) (string, error) {
	if !strings.Contains(s, "%") {
		return s, nil
	}
	hexAt := func(k int) (byte, bool) {
		if k+2 >= len(s) || s[k] != '%' {
			return 0, false
		}
		hi, ok1 := unhex(s[k+1])
		lo, ok2 := unhex(s[k+2])
		return hi<<4 | lo, ok1 && ok2
	}
	var out strings.Builder
	for k := 0; k < len(s); {
		if s[k] != '%' {
			out.WriteByte(s[k])
			k++
			continue
		}
		b, ok := hexAt(k)
		if !ok {
			return "", ErrURI
		}
		k += 3
		if b < 0x80 {
			out.WriteByte(b)
			continue
		}
		n := 0
		for mask := byte(0x80); b&mask != 0 && n < 8; mask >>= 1 {
			n++
		}
		if n == 1 || n > 4 {
			return "", ErrURI
		}
		octets := []byte{b}
		for j := 1; j < n; j++ {
			c, ok := hexAt(k)
			if !ok || c&0xC0 != 0x80 {
				return "", ErrURI
			}
			octets = append(octets, c)
			k += 3
		}
		if !utf8.Valid(octets) {
			return "", ErrURI
		}
		out.Write(octets)
	}
	return out.String(), nil
}
