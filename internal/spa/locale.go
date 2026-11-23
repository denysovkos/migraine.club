package spa

import (
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Locales of src/utils/AppConfig.ts (localePrefix 'as-needed').
var (
	Locales       = []string{"en", "fr", "uk"}
	DefaultLocale = "en"
)

const localeCookie = "NEXT_LOCALE"

// acceptLanguages is Negotiator's languages(): tags by descending quality,
// ties in header order, q=0 left out.
func acceptLanguages(header string) []string {
	type lang struct {
		tag string
		q   float64
		i   int
	}
	var out []lang
	for i, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		tag := strings.TrimSpace(fields[0])
		if tag == "" {
			continue
		}
		q := 1.0
		for _, p := range fields[1:] {
			p = strings.TrimSpace(p)
			if strings.HasPrefix(p, "q=") {
				if v, err := strconv.ParseFloat(p[2:], 64); err == nil {
					q = v
				}
			}
		}
		if q > 0 {
			out = append(out, lang{tag, q, i})
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].q > out[b].q })
	tags := make([]string, len(out))
	for i, l := range out {
		tags[i] = l.tag
	}
	return tags
}

// acceptLanguageLocale is next-intl's getAcceptLanguageLocale for this app's
// locales: the first requested language whose primary subtag is supported,
// else the default locale. Without the header Negotiator offers "*", which
// the matcher rejects: "" (undefined).
func acceptLanguageLocale(header string) string {
	if strings.TrimSpace(header) == "" {
		return ""
	}
	tags := acceptLanguages(header)
	// @formatjs/intl-localematcher throws on a tag that is not BCP 47 (such
	// as "*" or "en_US"), and next-intl then has no locale at all.
	for _, tag := range tags {
		if !validLanguageTag(tag) {
			return ""
		}
	}
	for _, tag := range tags {
		primary := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
		for _, l := range Locales {
			if primary == l {
				return l
			}
		}
	}
	return DefaultLocale
}

// pathnameMatch is getPathnameMatch: the locale whose prefix starts the path.
func pathnameMatch(pathname string) (locale string, exact bool) {
	for _, l := range Locales {
		prefix := "/" + l
		if pathname == prefix || strings.HasPrefix(pathname, prefix+"/") {
			return l, true
		}
		lower := strings.ToLower(pathname)
		if lower == prefix || strings.HasPrefix(lower, prefix+"/") {
			return l, false
		}
	}
	return "", false
}

// normalizedPathname is getNormalizedPathname: the path without its locale
// prefix (case-insensitive) and without a trailing slash.
func normalizedPathname(pathname string) string {
	if !strings.HasSuffix(pathname, "/") {
		pathname += "/"
	}
	lower := strings.ToLower(pathname)
	result := pathname
	for _, l := range Locales {
		if strings.HasPrefix(lower, "/"+l+"/") {
			result = "/" + pathname[len(l)+2:]
			break
		}
	}
	if result != "/" {
		result = strings.TrimSuffix(result, "/")
	}
	return result
}

var multiSlash = regexp.MustCompile(`/+`)

// sanitizePathname is next-intl's sanitizePathname.
func sanitizePathname(p string) string {
	p = strings.ReplaceAll(p, `\`, "%5C")
	p = strings.NewReplacer("\t", "", "\n", "", "\r", "").Replace(p)
	return multiSlash.ReplaceAllString(p, "/")
}

// decodePathname is decodeURI(pathname.replace(/%25/g, '%2525')): reserved
// characters stay encoded.
func decodePathname(p string) (string, bool) {
	p = strings.ReplaceAll(p, "%25", "%2525")
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		if p[i] != '%' {
			b.WriteByte(p[i])
			continue
		}
		if i+2 >= len(p) {
			return "", false
		}
		v, err := strconv.ParseUint(p[i+1:i+3], 16, 8)
		if err != nil {
			return "", false
		}
		if strings.ContainsRune(";/?:@&=+$,#", rune(v)) {
			b.WriteString(p[i : i+3])
		} else {
			b.WriteByte(byte(v))
		}
		i += 2
	}
	return b.String(), true
}

// localeResult is what the next-intl middleware decided for a page request.
type localeResult struct {
	redirect string // set when the response is a 307 to this location
	locale   string
	// internal is the unprefixed pathname the page tree renders.
	internal string
	links    string
	cookie   *http.Cookie
}

func cookieLocale(r *http.Request) string {
	c, err := r.Cookie(localeCookie)
	if err != nil {
		return ""
	}
	for _, l := range Locales {
		if c.Value == l {
			return l
		}
	}
	return ""
}

func prefixed(locale, pathname string) string {
	if pathname == "/" {
		return "/" + locale
	}
	return "/" + locale + pathname
}

func withSearch(pathname string, r *http.Request) string {
	if r.URL.RawQuery != "" {
		return pathname + "?" + r.URL.RawQuery
	}
	return pathname
}

// nextIntl is next-intl's createMiddleware for localePrefix 'as-needed'
// without domains or localized pathnames.
func nextIntl(r *http.Request, origin string) (localeResult, bool) {
	decoded, ok := decodePathname(r.URL.EscapedPath())
	if !ok {
		return localeResult{}, false
	}
	external := sanitizePathname(decoded)
	matched, exact := pathnameMatch(external)
	locale := matched
	if locale == "" {
		locale = cookieLocale(r)
	}
	if locale == "" {
		locale = acceptLanguageLocale(r.Header.Get("Accept-Language"))
	}
	if locale == "" {
		locale = DefaultLocale
	}
	isDefault := locale == DefaultLocale
	unprefixed := normalizedPathname(external)
	res := localeResult{locale: locale, internal: unprefixed}
	// Redirect targets are built from normalised pathnames, which carry no
	// trailing slash (normalizeTrailingSlash).
	redirectTo := func(p string) { res.redirect = p }
	switch {
	case unprefixed == "/" && matched == "":
		if !isDefault {
			redirectTo(withSearch(prefixed(locale, unprefixed), r))
		}
	case matched != "":
		switch {
		case !exact:
			redirectTo(withSearch(prefixed(matched, unprefixed), r))
		case isDefault:
			redirectTo(withSearch(unprefixed, r))
		}
	default:
		if !isDefault {
			redirectTo(withSearch(prefixed(locale, unprefixed), r))
		}
	}
	res.cookie = syncCookie(r, locale)
	if res.redirect == "" {
		res.links = alternateLinks(r, origin, unprefixed)
	}
	return res, true
}

// syncCookie is next-intl's syncCookie.
func syncCookie(r *http.Request, locale string) *http.Cookie {
	if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" && dest != "document" {
		return nil
	}
	c, err := r.Cookie(localeCookie)
	set := false
	switch {
	case err == nil && c.Value != locale:
		set = true
	case err != nil:
		set = acceptLanguageLocale(r.Header.Get("Accept-Language")) != locale
	}
	if !set {
		return nil
	}
	return &http.Cookie{Name: localeCookie, Value: locale, Path: "/", SameSite: http.SameSiteLaxMode}
}

// alternateLinks is getAlternateLinksHeaderValue.
func alternateLinks(r *http.Request, origin, unprefixed string) string {
	var links []string
	entry := func(p, locale string) string {
		if p != "/" {
			p = strings.TrimSuffix(p, "/")
		}
		return "<" + origin + p + `>; rel="alternate"; hreflang="` + locale + `"`
	}
	for _, l := range Locales {
		p := unprefixed
		if l != DefaultLocale {
			p = prefixed(l, unprefixed)
		}
		links = append(links, entry(p, l))
	}
	links = append(links, entry(unprefixed, "x-default"))
	return strings.Join(links, ", ")
}

// validLanguageTag is the structural check Intl.getCanonicalLocales makes:
// a 2-3 or 5-8 letter language, then subtags of 1-8 letters or digits, a
// single-character subtag always followed by another.
func validLanguageTag(tag string) bool {
	parts := strings.Split(tag, "-")
	isAlpha := func(s string) bool {
		for _, c := range s {
			if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') {
				return false
			}
		}
		return true
	}
	isAlnum := func(s string) bool {
		for _, c := range s {
			if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') {
				return false
			}
		}
		return true
	}
	lang := parts[0]
	if !isAlpha(lang) || len(lang) < 2 || len(lang) == 4 || len(lang) > 8 {
		return false
	}
	for i, p := range parts[1:] {
		if p == "" || len(p) > 8 || !isAlnum(p) {
			return false
		}
		if len(p) == 1 && i == len(parts)-2 {
			return false
		}
	}
	return true
}
