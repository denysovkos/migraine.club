// Package locales embeds the translation files so the Go server can render
// notification text from the same messages the UI uses.
package locales

import "embed"

// FS holds en.json, fr.json and uk.json.
//
//go:embed *.json
var FS embed.FS
