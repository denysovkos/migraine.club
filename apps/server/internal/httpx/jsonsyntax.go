package httpx

import (
	"strconv"
	"unicode/utf16"
)

// V8's JsonParser context window (json-parser.h).
const (
	jsonMaxContext       = 10
	jsonMinSourceContext = jsonMaxContext*2 + 1
)

// JSONSyntaxMessage is the message of the SyntaxError V8's JSON.parse throws
// for text, or "" when text is valid JSON. It follows V8's recursive-descent
// parser so the same position and wording come out; positions and context
// are in UTF-16 code units like the JavaScript string.
func JSONSyntaxMessage(text string) string {
	p := &jsonScan{s: utf16.Encode([]rune(text))}
	p.ws()
	if p.value() {
		p.ws()
		if p.i < len(p.s) {
			p.failAt("Unexpected non-whitespace character after JSON at position ", p.i)
		}
	}
	return p.msg
}

type jsonScan struct {
	s   []uint16
	i   int
	msg string
}

func (p *jsonScan) peek() int {
	if p.i >= len(p.s) {
		return -1
	}
	return int(p.s[p.i])
}

func (p *jsonScan) ws() {
	for p.i < len(p.s) {
		switch p.s[p.i] {
		case ' ', '\t', '\n', '\r':
			p.i++
		default:
			return
		}
	}
}

// fail reports a specific message template at pos.
func (p *jsonScan) fail(template string, pos int) bool {
	return p.failAt(template+" in JSON at position ", pos)
}

func (p *jsonScan) failAt(prefix string, pos int) bool {
	line, col := p.location(pos)
	p.msg = prefix + strconv.Itoa(pos) + " (line " + strconv.Itoa(line) + " column " + strconv.Itoa(col) + ")"
	return false
}

func (p *jsonScan) location(pos int) (int, int) {
	line, lastBreak := 1, 0
	for c := 0; c < pos; c++ {
		if p.s[c] == '\r' && c < pos-1 && p.s[c+1] == '\n' {
			c++
		}
		if p.s[c] == '\r' || p.s[c] == '\n' {
			line++
			lastBreak = c + 1
		}
	}
	return line, 1 + pos - lastBreak
}

func (p *jsonScan) str(from, to int) string { return string(utf16.Decode(p.s[from:to])) }

// unexpected is ReportUnexpectedToken without a specific message.
func (p *jsonScan) unexpected(pos int) bool {
	if pos >= len(p.s) {
		p.msg = "Unexpected end of JSON input"
		return false
	}
	src := p.str(0, len(p.s))
	switch src {
	case "[object Object]", "undefined", "Infinity", "NaN":
		p.msg = `"` + src + `" is not valid JSON`
		return false
	}
	tok := p.str(pos, pos+1)
	n := len(p.s)
	switch {
	case n < jsonMinSourceContext:
		p.msg = "Unexpected token '" + tok + "', \"" + src + "\" is not valid JSON"
	case pos < jsonMaxContext:
		p.msg = "Unexpected token '" + tok + "', \"" + p.str(0, pos+jsonMaxContext) + "\"... is not valid JSON"
	case pos < n-jsonMaxContext:
		p.msg = "Unexpected token '" + tok + "', ...\"" + p.str(pos-jsonMaxContext, pos+jsonMaxContext) + "\"... is not valid JSON"
	default:
		p.msg = "Unexpected token '" + tok + "', ...\"" + p.str(pos-jsonMaxContext, n) + "\" is not valid JSON"
	}
	return false
}

func isDigit(c int) bool { return c >= '0' && c <= '9' }

func (p *jsonScan) value() bool {
	switch c := p.peek(); {
	case c == '"':
		return p.string()
	case c == '-' || isDigit(c):
		return p.number()
	case c == '{':
		return p.object()
	case c == '[':
		return p.array()
	case c == 't':
		return p.literal("true")
	case c == 'f':
		return p.literal("false")
	case c == 'n':
		return p.literal("null")
	default:
		return p.unexpected(p.i)
	}
}

func (p *jsonScan) literal(word string) bool {
	for k := 0; k < len(word); k++ {
		if p.i+k >= len(p.s) {
			return p.unexpected(len(p.s))
		}
		if p.s[p.i+k] != uint16(word[k]) {
			return p.unexpected(p.i + k)
		}
	}
	p.i += len(word)
	return true
}

func (p *jsonScan) digits() {
	for isDigit(p.peek()) {
		p.i++
	}
}

func (p *jsonScan) number() bool {
	if p.peek() == '-' {
		p.i++
		if !isDigit(p.peek()) {
			return p.fail("No number after minus sign", p.i)
		}
	}
	if p.peek() == '0' {
		p.i++
		if isDigit(p.peek()) {
			return p.fail("Unexpected number", p.i)
		}
	} else {
		p.digits()
	}
	if p.peek() == '.' {
		p.i++
		if !isDigit(p.peek()) {
			return p.fail("Unterminated fractional number", p.i)
		}
		p.digits()
	}
	if c := p.peek(); c == 'e' || c == 'E' {
		p.i++
		if c := p.peek(); c == '+' || c == '-' {
			p.i++
		}
		if !isDigit(p.peek()) {
			return p.fail("Exponent part is missing a number", p.i)
		}
		p.digits()
	}
	return true
}

func isHex(c int) bool {
	return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func (p *jsonScan) string() bool {
	p.i++ // opening quote
	for {
		c := p.peek()
		switch {
		case c < 0:
			return p.fail("Unterminated string", p.i)
		case c == '"':
			p.i++
			return true
		case c < 0x20:
			return p.fail("Bad control character in string literal", p.i)
		case c == '\\':
			p.i++
			switch e := p.peek(); e {
			case -1:
				return p.unexpected(p.i)
			case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
				p.i++
			case 'u':
				p.i++
				for k := 0; k < 4; k++ {
					if !isHex(p.peek()) {
						return p.fail("Bad Unicode escape", p.i)
					}
					p.i++
				}
			default:
				return p.fail("Bad escaped character", p.i)
			}
		default:
			p.i++
		}
	}
}

func (p *jsonScan) object() bool {
	p.i++
	p.ws()
	if p.peek() == '}' {
		p.i++
		return true
	}
	if p.peek() != '"' {
		return p.fail("Expected property name or '}'", p.i)
	}
	for {
		if !p.string() {
			return false
		}
		p.ws()
		if p.peek() != ':' {
			return p.fail("Expected ':' after property name", p.i)
		}
		p.i++
		p.ws()
		if !p.value() {
			return false
		}
		p.ws()
		switch p.peek() {
		case '}':
			p.i++
			return true
		case ',':
			p.i++
			p.ws()
			if p.peek() != '"' {
				return p.fail("Expected double-quoted property name", p.i)
			}
		default:
			return p.fail("Expected ',' or '}' after property value", p.i)
		}
	}
}

func (p *jsonScan) array() bool {
	p.i++
	p.ws()
	if p.peek() == ']' {
		p.i++
		return true
	}
	for {
		if !p.value() {
			return false
		}
		p.ws()
		switch p.peek() {
		case ']':
			p.i++
			return true
		case ',':
			p.i++
			p.ws()
		default:
			return p.fail("Expected ',' or ']' after array element", p.i)
		}
	}
}
