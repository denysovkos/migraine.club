package jsontime

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestFormatMatchesToISOString(t *testing.T) {
	cases := map[string]time.Time{
		// new Date(Date.UTC(2026, 10, 22, 13, 5, 1, 0)).toISOString()
		"2026-11-22T13:05:01.000Z": time.Date(2026, 11, 22, 13, 5, 1, 0, time.UTC),
		// Microseconds are truncated, never rounded up.
		"2026-11-22T13:05:01.123Z": time.Date(2026, 11, 22, 13, 5, 1, 123999000, time.UTC),
		// Non-UTC input is converted to UTC.
		"2026-11-22T12:05:01.500Z": time.Date(2026, 11, 22, 13, 5, 1, 500000000, time.FixedZone("CET", 3600)),
	}
	for want, in := range cases {
		require.Equal(t, want, Format(in))
	}
}

func TestTimeJSON(t *testing.T) {
	v := struct {
		A Time  `json:"a"`
		B *Time `json:"b"`
		C *Time `json:"c"`
	}{A: New(time.Date(2026, 1, 2, 3, 4, 5, 6000000, time.UTC)), B: Ptr(time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC))}
	b, err := json.Marshal(v)
	require.NoError(t, err)
	require.JSONEq(t, `{"a":"2026-01-02T03:04:05.006Z","b":"2026-01-02T00:00:00.000Z","c":null}`, string(b))

	var back Time
	require.NoError(t, json.Unmarshal([]byte(`"2026-01-02T05:04:05.006+02:00"`), &back))
	require.Equal(t, "2026-01-02T03:04:05.006Z", Format(back.Time))
}

func TestDateJSON(t *testing.T) {
	var d Date
	require.NoError(t, d.Scan(time.Date(2026, 3, 29, 0, 0, 0, 0, time.UTC)))
	b, err := json.Marshal(d)
	require.NoError(t, err)
	require.Equal(t, `"2026-03-29T00:00:00.000Z"`, string(b))
	require.Equal(t, "2026-03-29", d.YMD())
	val, err := d.Value()
	require.NoError(t, err)
	require.Equal(t, "2026-03-29", val)
}

func TestParse(t *testing.T) {
	for _, s := range []string{"2026-01-02T03:04:05Z", "2026-01-02T03:04:05.123Z", "2026-01-02T05:04:05+02:00", "2026-01-02"} {
		_, err := Parse(s)
		require.NoError(t, err, s)
	}
	_, err := Parse("not a date")
	require.Error(t, err)
}
