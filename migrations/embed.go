// Package migrations embeds the SQL migrations and their journal so the server
// binary carries everything it needs to bring a database up to date.
package migrations

import "embed"

// FS holds every migration listed in meta/_journal.json.
//
//go:embed *.sql meta/_journal.json
var FS embed.FS
