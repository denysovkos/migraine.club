package jsx

import (
	"bytes"
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Restringify re-encodes JSON text the way JSON.stringify(JSON.parse(text),
// null, indent) does in V8: object keys that are array indices come first in
// ascending order, the rest keep their first-seen position (a duplicate key
// keeps that position and takes the last value), numbers are printed as JS
// numbers, and strings are escaped as JSON.stringify escapes them (U+2028 and
// U+2029 stay raw, other control characters use lowercase \u00xx).
func Restringify(text []byte, indent string) ([]byte, error) {
	v, err := ParseJSON(text)
	if err != nil {
		return nil, err
	}
	return Stringify(v, indent), nil
}

var errSyntax = errors.New("jsx: invalid JSON")

// JSONObject is a parsed JSON object: keys in source order, last value wins.
type JSONObject struct {
	keys []string
	vals map[string]any
}

// NewJSONObject returns an empty object.
func NewJSONObject() *JSONObject { return &JSONObject{vals: map[string]any{}} }

// Set adds or replaces a key; a new key goes last.
func (o *JSONObject) Set(k string, v any) *JSONObject {
	if _, ok := o.vals[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.vals[k] = v
	return o
}

// Get returns the value for k.
func (o *JSONObject) Get(k string) (any, bool) { v, ok := o.vals[k]; return v, ok }

// Keys are the keys in V8 enumeration order.
func (o *JSONObject) Keys() []string { return o.orderedKeys() }

// Len is the number of keys.
func (o *JSONObject) Len() int { return len(o.keys) }

// ParseJSON is JSON.parse: objects become *JSONObject, arrays []any, numbers
// float64.
func ParseJSON(text []byte) (any, error) {
	p := jsonParser{s: text}
	p.ws()
	v, err := p.value()
	if err != nil {
		return nil, err
	}
	p.ws()
	if p.i != len(p.s) {
		return nil, errSyntax
	}
	return v, nil
}

// Stringify is JSON.stringify(v, null, indent) for values ParseJSON returns.
func Stringify(v any, indent string) []byte {
	var b bytes.Buffer
	writeValue(&b, v, indent, "")
	return b.Bytes()
}

type jsonParser struct {
	s []byte
	i int
}

func (p *jsonParser) ws() {
	for p.i < len(p.s) {
		switch p.s[p.i] {
		case ' ', '\t', '\n', '\r':
			p.i++
		default:
			return
		}
	}
}

func (p *jsonParser) value() (any, error) {
	if p.i >= len(p.s) {
		return nil, errSyntax
	}
	switch p.s[p.i] {
	case '{':
		return p.object()
	case '[':
		return p.array()
	case '"':
		return p.str()
	case 't':
		return true, p.lit("true")
	case 'f':
		return false, p.lit("false")
	case 'n':
		return nil, p.lit("null")
	default:
		return p.number()
	}
}

func (p *jsonParser) lit(w string) error {
	if !bytes.HasPrefix(p.s[p.i:], []byte(w)) {
		return errSyntax
	}
	p.i += len(w)
	return nil
}

func (p *jsonParser) number() (float64, error) {
	start := p.i
	for p.i < len(p.s) && strings.IndexByte("+-0123456789.eE", p.s[p.i]) >= 0 {
		p.i++
	}
	f, err := strconv.ParseFloat(string(p.s[start:p.i]), 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, errSyntax
	}
	return f, nil
}

func (p *jsonParser) str() (string, error) {
	p.i++
	var b strings.Builder
	for p.i < len(p.s) {
		c := p.s[p.i]
		switch c {
		case '"':
			p.i++
			return b.String(), nil
		case '\\':
			if p.i+1 >= len(p.s) {
				return "", errSyntax
			}
			e := p.s[p.i+1]
			p.i += 2
			switch e {
			case '"', '\\', '/':
				b.WriteByte(e)
			case 'b':
				b.WriteByte('\b')
			case 'f':
				b.WriteByte('\f')
			case 'n':
				b.WriteByte('\n')
			case 'r':
				b.WriteByte('\r')
			case 't':
				b.WriteByte('\t')
			case 'u':
				r, err := p.hex4()
				if err != nil {
					return "", err
				}
				if r >= 0xD800 && r < 0xDC00 && bytes.HasPrefix(p.s[p.i:], []byte(`\u`)) {
					save := p.i
					p.i += 2
					lo, err := p.hex4()
					if err == nil && lo >= 0xDC00 && lo < 0xE000 {
						r = (r-0xD800)<<10 + (lo - 0xDC00) + 0x10000
					} else {
						p.i = save
					}
				}
				if r >= 0xD800 && r < 0xE000 {
					// Lone surrogate: keep it as WTF-8 so quote can re-escape it.
					b.Write([]byte{0xED, byte(0x80 | (r>>6)&0x3F), byte(0x80 | r&0x3F)})
				} else {
					b.WriteRune(r)
				}
			default:
				return "", errSyntax
			}
		default:
			b.WriteByte(c)
			p.i++
		}
	}
	return "", errSyntax
}

func (p *jsonParser) hex4() (rune, error) {
	if p.i+4 > len(p.s) {
		return 0, errSyntax
	}
	n, err := strconv.ParseUint(string(p.s[p.i:p.i+4]), 16, 32)
	if err != nil {
		return 0, errSyntax
	}
	p.i += 4
	return rune(n), nil
}

func (p *jsonParser) array() ([]any, error) {
	p.i++
	out := []any{}
	p.ws()
	if p.i < len(p.s) && p.s[p.i] == ']' {
		p.i++
		return out, nil
	}
	for {
		p.ws()
		v, err := p.value()
		if err != nil {
			return nil, err
		}
		out = append(out, v)
		p.ws()
		if p.i >= len(p.s) {
			return nil, errSyntax
		}
		if p.s[p.i] == ']' {
			p.i++
			return out, nil
		}
		if p.s[p.i] != ',' {
			return nil, errSyntax
		}
		p.i++
	}
}

func (p *jsonParser) object() (*JSONObject, error) {
	p.i++
	o := NewJSONObject()
	p.ws()
	if p.i < len(p.s) && p.s[p.i] == '}' {
		p.i++
		return o, nil
	}
	for {
		p.ws()
		if p.i >= len(p.s) || p.s[p.i] != '"' {
			return nil, errSyntax
		}
		k, err := p.str()
		if err != nil {
			return nil, err
		}
		p.ws()
		if p.i >= len(p.s) || p.s[p.i] != ':' {
			return nil, errSyntax
		}
		p.i++
		p.ws()
		v, err := p.value()
		if err != nil {
			return nil, err
		}
		o.Set(k, v)
		p.ws()
		if p.i >= len(p.s) {
			return nil, errSyntax
		}
		if p.s[p.i] == '}' {
			p.i++
			return o, nil
		}
		if p.s[p.i] != ',' {
			return nil, errSyntax
		}
		p.i++
	}
}

// arrayIndex reports whether k is a canonical array index (0 .. 2^32-2),
// which V8 enumerates before other keys.
func arrayIndex(k string) (uint64, bool) {
	if k == "" || len(k) > 10 || (len(k) > 1 && k[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseUint(k, 10, 64)
	if err != nil || n >= math.MaxUint32 {
		return 0, false
	}
	return n, true
}

// orderedKeys is V8's own-property enumeration order.
func (o *JSONObject) orderedKeys() []string {
	var idx, rest []string
	for _, k := range o.keys {
		if _, ok := arrayIndex(k); ok {
			idx = append(idx, k)
		} else {
			rest = append(rest, k)
		}
	}
	slices.SortFunc(idx, func(a, b string) int {
		x, _ := arrayIndex(a)
		y, _ := arrayIndex(b)
		return int(int64(x) - int64(y))
	})
	return append(idx, rest...)
}

// QuoteJSON is JSON.stringify for a string.
func QuoteJSON(s string) string {
	var b bytes.Buffer
	quote(&b, s)
	return b.String()
}

func quote(b *bytes.Buffer, s string) {
	b.WriteByte('"')
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 && i+2 < len(s) && s[i] == 0xED && s[i+1] >= 0xA0 && s[i+1] <= 0xBF {
			r, size = rune(0xD000|rune(s[i+1]&0x3F)<<6|rune(s[i+2]&0x3F)), 3
		}
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20:
			b.WriteString(`\u00`)
			b.WriteByte("0123456789abcdef"[r>>4])
			b.WriteByte("0123456789abcdef"[r&0xF])
		case r >= 0xD800 && r < 0xE000:
			// A lone surrogate (WTF-8 from \uD800 escapes); JSON.stringify
			// writes it as an escape.
			b.WriteString(`\u` + strconv.FormatInt(int64(r), 16))
		default:
			b.WriteString(s[i : i+size])
		}
		i += size
	}
	b.WriteByte('"')
}

func writeValue(b *bytes.Buffer, v any, indent, cur string) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			b.WriteString("null")
		} else {
			b.WriteString(FormatNumber(x))
		}
	case string:
		quote(b, x)
	case []any:
		if len(x) == 0 {
			b.WriteString("[]")
			return
		}
		inner := cur + indent
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if indent != "" {
				b.WriteString("\n" + inner)
			}
			writeValue(b, e, indent, inner)
		}
		if indent != "" {
			b.WriteString("\n" + cur)
		}
		b.WriteByte(']')
	case *JSONObject:
		if len(x.keys) == 0 {
			b.WriteString("{}")
			return
		}
		inner := cur + indent
		b.WriteByte('{')
		for i, k := range x.orderedKeys() {
			if i > 0 {
				b.WriteByte(',')
			}
			if indent != "" {
				b.WriteString("\n" + inner)
			}
			quote(b, k)
			b.WriteByte(':')
			if indent != "" {
				b.WriteByte(' ')
			}
			writeValue(b, x.vals[k], indent, inner)
		}
		if indent != "" {
			b.WriteString("\n" + cur)
		}
		b.WriteByte('}')
	}
}

// OwnKeys orders object keys as V8 enumerates them (Object.keys,
// Object.entries, for-in): array indices ascending, then the rest in
// insertion order.
func OwnKeys(insertion []string) []string {
	return (&JSONObject{keys: insertion}).orderedKeys()
}

// ToPropertyKey is String(v) for a value ParseJSON returns, which is what
// using it as an object key does.
func ToPropertyKey(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return FormatNumber(x)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = ToPropertyKey(e)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// MarshalJSON lets encoding/json embed the object as JSON.stringify prints it.
func (o *JSONObject) MarshalJSON() ([]byte, error) { return Stringify(o, ""), nil }
