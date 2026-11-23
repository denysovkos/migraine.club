package q

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

var updateRe = regexp.MustCompile(`(?is)\bUPDATE\s+"?(\w+)"?\s+SET\b(.*?)(;|\z)`)

// Drizzle set $onUpdate columns (updated_at) on every update. Hand-written SQL
// must do it explicitly; this keeps that from being forgotten.
func TestUpdatesRefreshOnUpdateColumns(t *testing.T) {
	files, err := filepath.Glob("../queries/*.sql")
	require.NoError(t, err)
	require.NotEmpty(t, files)
	for _, f := range files {
		raw, err := os.ReadFile(f)
		require.NoError(t, err)
		for _, stmt := range strings.Split(string(raw), "-- name:") {
			for _, m := range updateRe.FindAllStringSubmatch(stmt, -1) {
				for _, col := range OnUpdateColumns[m[1]] {
					require.Regexp(t, `\b`+col+`\s*=`, m[2], "%s: UPDATE %s must set %s", filepath.Base(f), m[1], col)
				}
			}
		}
	}
}
