// Package i18n is src/libs/i18nMessages: a small server-side translator for
// jobs and notifications.
package i18n

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/locales"
)

// DefaultLocale is AppConfig.defaultLocale.
const DefaultLocale = "en"

var (
	mu    sync.Mutex
	cache = map[string]any{}
)

func load(locale string) (any, error) {
	mu.Lock()
	defer mu.Unlock()
	if m, ok := cache[locale]; ok {
		return m, nil
	}
	b, err := locales.FS.ReadFile(locale + ".json")
	if err != nil {
		// The dynamic import of ../locales/${locale}.json rejected.
		return nil, fmt.Errorf("Cannot find module '../locales/%s.json'", locale)
	}
	var m any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	cache[locale] = m
	return m, nil
}

// Translator is the function getServerTranslator resolves to.
type Translator func(key string, values ...any) string

var placeholder = regexp.MustCompile(`\{(\w+)\}`)

// New is getServerTranslator(locale, namespace). An empty locale is the
// default; values are key/value pairs, nil values print as "".
func New(locale, namespace string) (Translator, error) {
	if locale == "" {
		locale = DefaultLocale
	}
	msgs, err := load(locale)
	if err != nil {
		return nil, err
	}
	return func(key string, values ...any) string {
		full := namespace + "." + key
		cur := msgs
		for _, p := range strings.Split(full, ".") {
			m, ok := cur.(map[string]any)
			if !ok {
				return full
			}
			cur = m[p]
		}
		raw, ok := cur.(string)
		if !ok {
			return full
		}
		if len(values) == 0 {
			return raw
		}
		vals := map[string]any{}
		for i := 0; i+1 < len(values); i += 2 {
			vals[values[i].(string)] = values[i+1]
		}
		return placeholder.ReplaceAllStringFunc(raw, func(m string) string {
			v, ok := vals[m[1:len(m)-1]]
			if !ok || v == nil {
				return ""
			}
			switch n := v.(type) {
			case int:
				return jsx.FormatNumber(float64(n))
			case int32:
				return jsx.FormatNumber(float64(n))
			case int64:
				return jsx.FormatNumber(float64(n))
			}
			return jsx.String(v)
		})
	}, nil
}
