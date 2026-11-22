package jsx

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStrings(t *testing.T) {
	require.Equal(t, 2, Len("😀"))
	require.Equal(t, "ab", Slice("abc", 0, 2))
	require.Equal(t, "abc", Slice("abc", 0, 50))
	require.Equal(t, "x", Trim("  x \n"))
}

func TestNumbers(t *testing.T) {
	require.Equal(t, int32(-2147483648), ToInt32(2147483648))
	require.Equal(t, int32(1), ToInt32(4294967297))
	require.Equal(t, int32(-1), ToInt32(-1))
	require.Equal(t, 3.0, Round(2.5))
	require.Equal(t, -2.0, Round(-2.5))
	require.Equal(t, -1.0, Mod(-7, 3))
}

func TestParseFloatLikeJS(t *testing.T) {
	cases := map[string]float64{"3.33": 3.33, " 4abc": 4, "-1.5e2x": -150, ".5": 0.5, "5.": 5, "1e": 1, "12px": 12}
	for in, want := range cases {
		require.Equal(t, want, ParseFloat(in), in)
	}
	for _, in := range []string{"", "abc", "-", ".", "e5"} {
		require.True(t, ParseFloat(in) != ParseFloat(in), in) // NaN
	}
}

func TestStringAndToNumber(t *testing.T) {
	require.Equal(t, "2.5", String(2.5))
	require.Equal(t, "1e+21", String(1e21))
	require.Equal(t, "1e-7", String(1e-7))
	require.Equal(t, "null", String(nil))
	require.Equal(t, "G1", String("G1"))
	require.Equal(t, 0.0, ToNumber(""))
	require.Equal(t, 1734566400000.0, ToNumber("1734566400000"))
}

func TestCompareUTF16(t *testing.T) {
	// U+FF5E sorts after U+1F600 in UTF-8 bytes but before it in UTF-16.
	require.Negative(t, CompareUTF16("😀", "～"))
	require.Negative(t, CompareUTF16("a", "b"))
	require.Negative(t, CompareUTF16("a", "ab"))
	require.Zero(t, CompareUTF16("x", "x"))
}
