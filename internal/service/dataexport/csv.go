package dataexport

import (
	"strings"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// formulaPrefixes are FORMULA_PREFIXES (OWASP CSV injection guidance).
const formulaPrefixes = "=+-@\t\r"

// FormatCell is formatCsvCell. isDate marks a value Drizzle read as a JS
// Date: its ISO text is written as is, never formula-escaped.
func FormatCell(v any, isDate bool) string {
	var text string
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		switch {
		case isDate:
			text = x
		case x != "" && strings.ContainsRune(formulaPrefixes, rune(x[0])):
			text = "'" + x
		default:
			text = x
		}
	case float64:
		text = jsx.FormatNumber(x)
	case bool:
		if x {
			text = "true"
		} else {
			text = "false"
		}
	default:
		text = string(jsx.Stringify(x, ""))
	}
	if strings.ContainsAny(text, "\",\r\n") {
		return `"` + strings.ReplaceAll(text, `"`, `""`) + `"`
	}
	return text
}

// ToCSV is toCsv with explicit columns.
func ToCSV(rows []Row, columns []string) string {
	var b strings.Builder
	for i, c := range columns {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(FormatCell(c, false))
	}
	for _, r := range rows {
		b.WriteString("\r\n")
		for i, c := range columns {
			if i > 0 {
				b.WriteByte(',')
			}
			v, _ := r.Obj.Get(c)
			b.WriteString(FormatCell(v, r.Dates[c]))
		}
	}
	b.WriteString("\r\n")
	return b.String()
}

// csvReadme is CSV_README.
const csvReadme = `migraine.club data export

Each CSV file holds one kind of record, named after the database table it
comes from. Times are UTC in ISO 8601 format. Fields that hold lists or
structured values are written as JSON text inside the cell. Text that starts
with = + - or @ is prefixed with a single quote so spreadsheet apps do not run
it as a formula.

Share-link tokens, notification keys and payment-provider identifiers are left
out because they are credentials, not personal data.

The same data in a single machine-readable file is available as JSON from
Settings > Privacy.
`

// bom makes spreadsheet apps detect UTF-8.
const bom = "\uFEFF"

// CSVArchive is buildCsvArchive.
func (e *Export) CSVArchive() ([]byte, error) {
	counts := jsx.NewJSONObject()
	for _, t := range e.Tables {
		counts.Set(t.Name, float64(len(t.Rows)))
	}
	obj := e.object()
	manifest := jsx.NewJSONObject()
	for _, k := range []string{"format", "formatVersion", "exportedAt", "userId"} {
		v, _ := obj.Get(k)
		manifest.Set(k, v)
	}
	manifest.Set("counts", counts)
	entries := []ZipEntry{
		{Name: "README.txt", Data: []byte(csvReadme)},
		{Name: "manifest.json", Data: jsx.Stringify(manifest, "  ")},
	}
	for _, t := range e.Tables {
		entries = append(entries, ZipEntry{Name: t.Name + ".csv", Data: []byte(bom + ToCSV(t.Rows, t.Columns))})
	}
	return CreateZip(entries, e.ExportedAt)
}
