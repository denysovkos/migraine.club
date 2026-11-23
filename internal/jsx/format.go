package jsx

import (
	"math"
	"math/big"
	"strings"
	"sync"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// ToFixed is Number.prototype.toFixed(digits) for finite |x| < 1e21: the
// exact binary value rounded half away from zero, as the spec's "pick the
// larger n" does on the magnitude.
func ToFixed(x float64, digits int) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if math.Abs(x) >= 1e21 || math.IsInf(x, 0) {
		return FormatNumber(x)
	}
	neg := x < 0
	if neg {
		x = -x
	}
	// Exact decimal expansion of the double, then round half up.
	exact := new(big.Float).SetPrec(2048).SetFloat64(x).Text('f', 1100)
	intPart, frac, _ := strings.Cut(exact, ".")
	keep := frac[:digits]
	roundUp := len(frac) > digits && frac[digits] >= '5'
	digitsStr := intPart + keep
	if roundUp {
		b := []byte(digitsStr)
		i := len(b) - 1
		for ; i >= 0; i-- {
			if b[i] == '9' {
				b[i] = '0'
				continue
			}
			b[i]++
			break
		}
		digitsStr = string(b)
		if i < 0 {
			digitsStr = "1" + digitsStr
		}
	}
	whole := digitsStr[:len(digitsStr)-digits]
	out := whole
	if digits > 0 {
		out += "." + digitsStr[len(digitsStr)-digits:]
	}
	if neg {
		out = "-" + out // also (-0.04).toFixed(1) == "-0.0"
	}
	return out
}

var (
	collatorMu sync.Mutex
	collator   = collate.New(language.AmericanEnglish)
)

// LocaleCompare is String.prototype.localeCompare with Node's default
// (en-US) collator.
func LocaleCompare(a, b string) int {
	collatorMu.Lock()
	defer collatorMu.Unlock()
	return collator.CompareString(a, b)
}
