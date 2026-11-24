package localdate

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Expectations are V8's `new Date(s + "T00:00:00.000Z").toISOString()`.
func TestJSDateFromYMD(t *testing.T) {
	ok := map[string]string{
		"2024-02-30": "2024-03-01", "2024-02-31": "2024-03-02", "2023-02-29": "2023-03-01",
		"2024-04-31": "2024-05-01", "2024-06-31": "2024-07-01", "0000-02-30": "0000-03-01",
		"2024-12-31": "2024-12-31", "9999-12-31": "9999-12-31", "0000-01-01": "0000-01-01",
	}
	for in, want := range ok {
		got, err := JSDateFromYMD(in)
		require.NoError(t, err, in)
		require.Equal(t, want, got.Format(Layout), in)
	}
	for _, in := range []string{"2024-02-32", "2024-13-01", "2024-00-10", "2024-01-00", "2024-1-01"} {
		_, err := JSDateFromYMD(in)
		require.ErrorIs(t, err, ErrInvalidTimeValue, in)
		require.EqualError(t, err, "Invalid time value")
	}
}
