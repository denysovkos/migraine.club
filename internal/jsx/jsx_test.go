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
