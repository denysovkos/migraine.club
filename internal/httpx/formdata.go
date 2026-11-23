package httpx

import (
	"bytes"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// This file is `await request.formData()` as Node's bundled undici
// implements it (lib/web/fetch/formdata-parser.js and data-url.js), so a
// request Next accepted or rejected is accepted or rejected the same way.

// MIMEType is a parsed WHATWG MIME type.
type MIMEType struct {
	Essence string
	Params  map[string]string
}

var (
	httpToken        = regexp.MustCompile("^[-!#$%&'*+.^_`|~A-Za-z0-9]+$")
	httpQuotedTokens = regexp.MustCompile("^[\t\x20-\x7e\u0080-ÿ]+$")
)

func isHTTPWhitespace(c rune) bool { return c == '\r' || c == '\n' || c == '\t' || c == ' ' }

func trimHTTPWhitespace(s []rune, leading, trailing bool) []rune {
	if leading {
		for len(s) > 0 && isHTTPWhitespace(s[0]) {
			s = s[1:]
		}
	}
	if trailing {
		for len(s) > 0 && isHTTPWhitespace(s[len(s)-1]) {
			s = s[:len(s)-1]
		}
	}
	return s
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

// ParseMIMEType is undici's parseMIMEType; ok is false for "failure". The
// header value is a Latin-1 string, one rune per byte.
func ParseMIMEType(header string) (MIMEType, bool) {
	in := trimHTTPWhitespace(latin1(header), true, true)
	pos := 0
	collect := func(stop rune) string {
		start := pos
		for pos < len(in) && in[pos] != stop {
			pos++
		}
		return string(in[start:pos])
	}
	typ := collect('/')
	if typ == "" || !httpToken.MatchString(typ) || pos >= len(in) {
		return MIMEType{}, false
	}
	pos++
	subtype := string(trimHTTPWhitespace([]rune(collect(';')), false, true))
	if subtype == "" || !httpToken.MatchString(subtype) {
		return MIMEType{}, false
	}
	m := MIMEType{Essence: asciiLower(typ) + "/" + asciiLower(subtype), Params: map[string]string{}}
	for pos < len(in) {
		pos++
		for pos < len(in) && isHTTPWhitespace(in[pos]) {
			pos++
		}
		start := pos
		for pos < len(in) && in[pos] != ';' && in[pos] != '=' {
			pos++
		}
		name := asciiLower(string(in[start:pos]))
		if pos < len(in) {
			if in[pos] == ';' {
				continue
			}
			pos++
		}
		if pos >= len(in) {
			break
		}
		var value string
		if in[pos] == '"' {
			value = quotedString(in, &pos)
			collect(';')
		} else {
			value = string(trimHTTPWhitespace([]rune(collect(';')), false, true))
			if value == "" {
				continue
			}
		}
		if _, dup := m.Params[name]; name != "" && httpToken.MatchString(name) &&
			(value == "" || httpQuotedTokens.MatchString(value)) && !dup {
			m.Params[name] = value
		}
	}
	return m, true
}

// quotedString is collectAnHTTPQuotedString with extractValue.
func quotedString(in []rune, pos *int) string {
	var b strings.Builder
	*pos++
	for {
		for *pos < len(in) && in[*pos] != '"' && in[*pos] != '\\' {
			b.WriteRune(in[*pos])
			*pos++
		}
		if *pos >= len(in) {
			break
		}
		c := in[*pos]
		*pos++
		if c == '\\' {
			if *pos >= len(in) {
				b.WriteRune('\\')
				break
			}
			b.WriteRune(in[*pos])
			*pos++
			continue
		}
		break
	}
	return b.String()
}

func latin1(s string) []rune {
	r := make([]rune, len(s))
	for i := 0; i < len(s); i++ {
		r[i] = rune(s[i])
	}
	return r
}

// FormFile is a File entry.
type FormFile struct {
	Name, Type string
	Data       []byte
}

// FormEntry is one entry of the FormData.
type FormEntry struct {
	Name  string
	Value string
	File  *FormFile
}

// ErrFormData is the TypeError request.formData() threw.
var ErrFormData = errors.New("Failed to parse body as FormData.")

// ReadFormData is `await request.formData()`.
func ReadFormData(r *http.Request) ([]FormEntry, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	m, ok := ParseMIMEType(r.Header.Get("Content-Type"))
	if !ok || r.Header.Get("Content-Type") == "" {
		return nil, ErrFormData
	}
	switch m.Essence {
	case "multipart/form-data":
		return parseMultipart(body, m)
	case "application/x-www-form-urlencoded":
		// URLSearchParams never fails and yields only strings.
		return []FormEntry{}, nil
	}
	return nil, ErrFormData
}

func isToken(c byte) bool {
	return c <= 127 && c != ' ' && c != '\t' && c > 31 && c != 127 && !strings.ContainsRune(`()<>@,;:\"/[]?=`, rune(c))
}

type cursor struct {
	in  []byte
	pos int
}

func (c *cursor) collect(cond func(byte) bool) []byte {
	start := c.pos
	for c.pos < len(c.in) && cond(c.in[c.pos]) {
		c.pos++
	}
	return c.in[start:c.pos]
}

func (c *cursor) at(i int) int {
	if c.pos+i < len(c.in) {
		return int(c.in[c.pos+i])
	}
	return -1
}

func (c *cursor) crlf() bool { return c.at(0) == '\r' && c.at(1) == '\n' }

func trimBytes(b []byte, leading, trailing bool) []byte {
	lead, trail := 0, len(b)-1
	if leading {
		for lead < len(b) && (b[lead] == '\t' || b[lead] == ' ') {
			lead++
		}
	}
	if trailing {
		for trail > 0 && (b[trail] == '\t' || b[trail] == ' ') {
			trail--
		}
	}
	if lead == 0 && trail == len(b)-1 {
		return b
	}
	if trail+1 < lead {
		return b[:0]
	}
	return b[lead : trail+1]
}

func parseMultipart(input []byte, m MIMEType) ([]FormEntry, error) {
	bs, ok := m.Params["boundary"]
	if !ok {
		return nil, ErrFormData
	}
	// Buffer.from(`--${boundary}`, 'utf8') of a Latin-1 decoded string.
	boundary := []byte("--" + string(latin1(bs)))
	first := bytes.Index(input, boundary)
	if first == -1 {
		return nil, ErrFormData
	}
	c := &cursor{in: input, pos: first}
	entries := []FormEntry{}
	for {
		if c.pos+len(boundary) <= len(input) && bytes.Equal(input[c.pos:c.pos+len(boundary)], boundary) {
			c.pos += len(boundary)
		} else {
			return nil, ErrFormData
		}
		if c.at(0) == '-' && c.at(1) == '-' {
			return entries, nil
		}
		if !c.crlf() {
			return nil, ErrFormData
		}
		c.pos += 2
		h, err := parseHeaders(c)
		if err != nil {
			return nil, err
		}
		c.pos += 2
		idx := bytes.Index(input[c.pos:], boundary[2:])
		if idx == -1 {
			return nil, ErrFormData
		}
		end := c.pos + idx - 4
		var body []byte
		if end > c.pos {
			body = input[c.pos:end]
		}
		c.pos += len(body)
		if h.encoding == "base64" {
			body = nodeBase64(jsx.UTF8Decode(body, false))
		}
		if !c.crlf() {
			return nil, ErrFormData
		}
		c.pos += 2
		e := FormEntry{Name: h.name}
		if h.filename != nil {
			typ := "text/plain"
			if h.contentType != nil {
				typ = *h.contentType
			}
			e.File = &FormFile{Name: *h.filename, Type: blobType(typ), Data: append([]byte(nil), body...)}
		} else {
			e.Value = jsx.UTF8Decode(body, false)
		}
		entries = append(entries, e)
	}
}

// blobType is the File constructor's type option: non-ASCII becomes "",
// then anything outside U+0020..U+007E becomes "", else ASCII lowercase.
func blobType(t string) string {
	for _, r := range t {
		if r < 0x20 || r > 0x7e {
			return ""
		}
	}
	return asciiLower(t)
}

// nodeBase64 is Buffer.from(s, 'base64'): characters outside the (standard
// or URL-safe) alphabet are skipped and decoding stops at padding.
func nodeBase64(s string) []byte {
	var clean strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '=':
			i = len(s)
		case c == '-':
			clean.WriteByte('+')
		case c == '_':
			clean.WriteByte('/')
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/':
			clean.WriteByte(c)
		}
	}
	t := clean.String()
	if len(t)%4 == 1 {
		t = t[:len(t)-1]
	}
	out, _ := base64.RawStdEncoding.DecodeString(t)
	return out
}

type partHeaders struct {
	name                  string
	filename, contentType *string
	encoding              string
}

func parseHeaders(c *cursor) (partHeaders, error) {
	var h partHeaders
	var name *string
	for {
		if c.crlf() {
			if name == nil {
				return h, ErrFormData
			}
			h.name = *name
			return h, nil
		}
		hn := trimBytes(c.collect(func(b byte) bool { return b != '\n' && b != '\r' && b != ':' }), true, true)
		if !httpToken.Match(hn) {
			return h, ErrFormData
		}
		if c.at(0) != ':' {
			return h, ErrFormData
		}
		c.pos++
		c.collect(func(b byte) bool { return b == ' ' || b == '\t' })
		switch asciiLower(string(hn)) {
		case "content-disposition":
			name, h.filename = nil, nil
			extended := false
			if asciiLower(string(c.collect(isToken))) != "form-data" {
				return h, ErrFormData
			}
			for c.pos < len(c.in) && !c.crlf() {
				attr, val, ext, ok, err := dispositionAttribute(c)
				if err != nil {
					return h, err
				}
				if !ok {
					break
				}
				switch attr {
				case "name":
					v := val
					name = &v
				case "filename":
					if ext {
						v := val
						h.filename, extended = &v, true
					} else if !extended {
						v := val
						h.filename = &v
					}
				}
			}
			if name == nil {
				return h, ErrFormData
			}
		case "content-type":
			v := string(latin1(string(trimBytes(c.collect(func(b byte) bool { return b != '\n' && b != '\r' }), false, true))))
			h.contentType = &v
		case "content-transfer-encoding":
			h.encoding = string(latin1(string(trimBytes(c.collect(func(b byte) bool { return b != '\n' && b != '\r' }), false, true))))
		default:
			c.collect(func(b byte) bool { return b != '\n' && b != '\r' })
		}
		if !c.crlf() {
			return h, ErrFormData
		}
		c.pos += 2
	}
}

var (
	lf    = regexp.MustCompile(`(?i)%0A`)
	cr    = regexp.MustCompile(`(?i)%0D`)
	quote = regexp.MustCompile(`%22`)
)

func dispositionAttribute(c *cursor) (name, value string, extended, ok bool, err error) {
	if c.at(0) == ';' {
		c.pos++
	}
	c.collect(func(b byte) bool { return b == ' ' || b == '\t' })
	attr := c.collect(func(b byte) bool { return isToken(b) && b != '=' && b != '*' })
	if len(attr) == 0 {
		return "", "", false, false, nil
	}
	name = asciiLower(string(attr))
	extended = c.at(0) == '*'
	if extended {
		c.pos++
	}
	if c.at(0) != '=' {
		return "", "", false, false, nil
	}
	c.pos++
	c.collect(func(b byte) bool { return b == ' ' || b == '\t' })
	switch {
	case extended:
		hv := c.collect(func(b byte) bool { return b != ' ' && b != '\r' && b != '\n' && b != ';' })
		cs := bytes.IndexByte(hv, '\'')
		ls := -1
		if cs != -1 {
			if j := bytes.IndexByte(hv[cs+1:], '\''); j != -1 {
				ls = cs + 1 + j
			}
		}
		if cs == -1 || ls == -1 {
			return "", "", false, false, ErrFormData
		}
		if cs != 5 || (hv[0] != 'u' && hv[0] != 'U') || (hv[1] != 't' && hv[1] != 'T') || (hv[2] != 'f' && hv[2] != 'F') ||
			hv[3] != '-' || hv[4] != '8' {
			return "", "", false, false, ErrFormData
		}
		v, derr := jsx.DecodeURIComponent(jsx.UTF8Decode(hv[ls+1:], true))
		if derr != nil {
			return "", "", false, false, derr
		}
		value = v
	case c.at(0) == '"':
		c.pos++
		qv := c.collect(func(b byte) bool { return b != '\n' && b != '\r' && b != '"' })
		if c.at(0) != '"' {
			return "", "", false, false, ErrFormData
		}
		c.pos++
		value = quote.ReplaceAllString(cr.ReplaceAllString(lf.ReplaceAllString(jsx.UTF8Decode(qv, true), "\n"), "\r"), `"`)
	default:
		value = jsx.UTF8Decode(c.collect(func(b byte) bool { return isToken(b) && b != ';' }), true)
	}
	return name, value, extended, true, nil
}

// Get is FormData.get(name): the first entry with that name.
func Get(entries []FormEntry, name string) *FormEntry {
	for i := range entries {
		if entries[i].Name == name {
			return &entries[i]
		}
	}
	return nil
}
