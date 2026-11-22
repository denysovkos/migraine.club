// Package programcontent embeds the program definitions (frontmatter JSON and
// Markdown bodies) the Go server serves; the Node app read them from disk.
package programcontent

import "embed"

// FS holds content/programs.
//
//go:embed *.json *.md
var FS embed.FS
