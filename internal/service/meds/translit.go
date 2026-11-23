package meds

import (
	"regexp"
	"strings"
)

var cyrillicRe = regexp.MustCompile(`[\x{0400}-\x{04FF}]`)

// ContainsCyrillic is containsCyrillic.
func ContainsCyrillic(s string) bool { return cyrillicRe.MatchString(s) }

var translitMap = map[rune]string{
	'а': "a", 'б': "b", 'в': "v", 'ґ': "g", 'д': "d", 'е': "e", 'є': "ye", 'ж': "zh", 'з': "z",
	'і': "i", 'ї': "yi", 'к': "k", 'л': "l", 'м': "m", 'н': "n", 'о': "o", 'п': "p", 'р': "r",
	'с': "s", 'т': "t", 'у': "u", 'ф': "f", 'х': "kh", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "shch",
	'ю': "yu", 'я': "ya", 'ь': "", 'ъ': "", '’': "", '\'': "", 'ё': "yo", 'э': "e",
}

var translitBranches = map[rune][]string{'г': {"g", "h"}, 'и': {"i", "y"}, 'й': {"i", "y"}}

var (
	nonLatin = regexp.MustCompile(`[^a-z0-9\s\x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}-]`)
)

// CyrillicToLatinVariants is cyrillicToLatinVariants.
func CyrillicToLatinVariants(input string, maxVariants int) []string {
	variants := []string{""}
	for _, ch := range strings.ToLower(input) {
		opts, ok := translitBranches[ch]
		if !ok {
			if m, ok := translitMap[ch]; ok {
				opts = []string{m}
			} else {
				opts = []string{string(ch)}
			}
		}
		var next []string
	outer:
		for _, v := range variants {
			for _, o := range opts {
				next = append(next, v+o)
				if len(next) >= maxVariants {
					break outer
				}
			}
		}
		variants = next
	}
	seen := map[string]bool{}
	var out []string
	for _, v := range variants {
		c := NormalizeName(nonLatin.ReplaceAllString(v, " "))
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
		if len(out) == maxVariants {
			break
		}
	}
	return out
}
