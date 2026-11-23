package community_test

import (
	"os"
	"testing"
	"time"
)

// TestMain pins the local zone before any test starts: Node ran in UTC,
// and assigning time.Local inside a test races with the database pool's
// goroutines, which read it.
func TestMain(m *testing.M) {
	time.Local = time.UTC
	os.Exit(m.Run())
}
