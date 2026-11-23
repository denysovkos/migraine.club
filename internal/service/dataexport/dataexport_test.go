package dataexport_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/service/dataexport"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

func TestFormatCell(t *testing.T) {
	require.Empty(t, dataexport.FormatCell(nil, false))
	require.Equal(t, "2026-03-01T10:15:00.000Z", dataexport.FormatCell("2026-03-01T10:15:00.000Z", true))
	require.Equal(t, `"[""nausea"",""aura""]"`, dataexport.FormatCell([]any{"nausea", "aura"}, false))
	require.Equal(t, `"a,b"`, dataexport.FormatCell("a,b", false))
	require.Equal(t, `"say ""hi"""`, dataexport.FormatCell(`say "hi"`, false))
	require.Equal(t, "\"line1\nline2\"", dataexport.FormatCell("line1\nline2", false))
	require.Equal(t, `"'=HYPERLINK(""x"")"`, dataexport.FormatCell(`=HYPERLINK("x")`, false))
	require.Equal(t, "'@cmd", dataexport.FormatCell("@cmd", false))
	require.Equal(t, "'-3", dataexport.FormatCell("-3", false), "numeric columns arrive as strings")
	require.Equal(t, "-3", dataexport.FormatCell(-3.0, false))
	require.Equal(t, "1e+21", dataexport.FormatCell(1e21, false))
	require.Equal(t, "true", dataexport.FormatCell(true, false))
	// A JS Date is never formula-escaped, even for a negative year.
	require.Equal(t, "-000001-01-01T00:00:00.000Z", dataexport.FormatCell("-000001-01-01T00:00:00.000Z", true))
	obj, _ := jsx.ParseJSON([]byte(`{"b":1,"1":"x"}`))
	require.Equal(t, `"{""1"":""x"",""b"":1}"`, dataexport.FormatCell(obj, false))
}

func TestToCSV(t *testing.T) {
	o1, _ := jsx.ParseJSON([]byte(`{"id":1,"notes":"x","intensity":null}`))
	o2, _ := jsx.ParseJSON([]byte(`{"id":2,"notes":null,"intensity":7}`))
	rows := []dataexport.Row{{Obj: o1.(*jsx.JSONObject)}, {Obj: o2.(*jsx.JSONObject)}}
	require.Equal(t, "id,notes,intensity\r\n1,x,\r\n2,,7\r\n", dataexport.ToCSV(rows, []string{"id", "notes", "intensity"}))
	require.Equal(t, "id\r\n", dataexport.ToCSV(nil, []string{"id"}))
}

func TestCreateZipRoundTrips(t *testing.T) {
	when := time.Date(2026, 3, 1, 10, 15, 31, 0, time.UTC)
	data, err := dataexport.CreateZip([]dataexport.ZipEntry{
		{Name: "a.txt", Data: []byte("hello")},
		{Name: "ü.csv", Data: []byte(strings.Repeat("Kopfschmerz, ", 200))},
	}, when)
	require.NoError(t, err)
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	require.Len(t, r.File, 2)
	require.Equal(t, "ü.csv", r.File[1].Name)
	require.Equal(t, uint16(0x0800), r.File[1].Flags)
	require.Equal(t, time.Date(2026, 3, 1, 10, 15, 30, 0, time.UTC), r.File[0].Modified.UTC())
	f, _ := r.File[1].Open()
	got, _ := io.ReadAll(f)
	require.Equal(t, strings.Repeat("Kopfschmerz, ", 200), string(got))

	empty, err := dataexport.CreateZip(nil, when)
	require.NoError(t, err)
	require.Len(t, empty, 22)
	_, err = zip.NewReader(bytes.NewReader(empty), 22)
	require.NoError(t, err)
}

func TestTablesExistInTheSchema(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range dataexport.Tables {
		meta, ok := q.Tables[s.Table]
		require.True(t, ok, s.Table)
		require.False(t, seen[s.Table], "duplicate %s", s.Table)
		seen[s.Table] = true
		require.Contains(t, meta.Columns, s.Owner, s.Table)
		for _, k := range s.Omit {
			require.Contains(t, meta.Keys, k, s.Table)
		}
	}
}

func TestCollectScopesToTheUserAndOmitsCredentials(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	for _, sql := range []string{
		`INSERT INTO "user" (id, display_name, stripe_customer_id) VALUES ('u1', 'Me', 'cus_1'), ('u2', 'Other', 'cus_2')`,
		`INSERT INTO doctor_share_link (user_id, token, expires_at) VALUES ('u1', 'tok', now()), ('u2', 'tok2', now())`,
		`INSERT INTO push_subscription (user_id, endpoint, p256dh, auth) VALUES ('u1', 'https://e', 'k', 'a')`,
		`INSERT INTO community_post (author_id, title, body) VALUES ('u1', 't', 'b'), ('u2', 'x', 'y')`,
		`INSERT INTO doctor_verification_application (user_id, full_name, country, license_number, specialty, verification_method, admin_notes)
		 VALUES ('u1', 'Dr Me', 'DE', 'L1', 'neuro', 'license', 'staff only')`,
		`INSERT INTO doctor_verification_file (application_id, original_name, stored_name, relative_path, mime_type, size_bytes)
		 SELECT id, 'license.pdf', 'abc', 'x/abc', 'application/pdf', 10 FROM doctor_verification_application`,
	} {
		_, err := pool.Exec(ctx, sql)
		require.NoError(t, err, sql)
	}
	now := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	e, err := dataexport.Collect(ctx, pool, "u1", now)
	require.NoError(t, err)

	var doc map[string]any
	require.NoError(t, json.Unmarshal(e.JSON(), &doc))
	require.Equal(t, "migraine.club/user-data-export", doc["format"])
	require.Equal(t, "2026-03-01T10:00:00.000Z", doc["exportedAt"])
	tables := doc["tables"].(map[string]any)
	users := tables["user"].([]any)
	require.Len(t, users, 1)
	require.NotContains(t, users[0], "stripeCustomerId")
	require.Equal(t, "Me", users[0].(map[string]any)["displayName"])
	links := tables["doctor_share_link"].([]any)
	require.Len(t, links, 1)
	require.NotContains(t, links[0], "token")
	require.NotContains(t, tables["push_subscription"].([]any)[0], "endpoint")
	require.Len(t, tables["community_post"].([]any), 1)
	app := tables["doctor_verification_application"].([]any)[0].(map[string]any)
	require.NotContains(t, app, "adminNotes")
	files := tables["doctor_verification_file"].([]any)
	require.Len(t, files, 1)
	require.NotContains(t, files[0], "storedName")
	require.NotContains(t, files[0], "relativePath")
	require.Equal(t, 6, e.CountRows())

	// Table order is EXPORT_TABLES plus the files, and the JSON is indented.
	names := make([]string, len(e.Tables))
	for i, tr := range e.Tables {
		names[i] = tr.Name
	}
	require.Equal(t, "doctor_verification_file", names[len(names)-1])
	require.Equal(t, "user", names[0])
	require.True(t, strings.HasPrefix(string(e.JSON()), "{\n  \"format\": "))

	archive, err := e.CSVArchive()
	require.NoError(t, err)
	r, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	require.NoError(t, err)
	var got []string
	for _, f := range r.File {
		got = append(got, f.Name)
	}
	require.Equal(t, []string{"README.txt", "manifest.json", "user.csv"}, got[:3])
	require.True(t, slices.Contains(got, "doctor_verification_file.csv"))
	f, _ := r.File[2].Open()
	csv, _ := io.ReadAll(f)
	require.True(t, strings.HasPrefix(string(csv), "\uFEFFid,stripeSubscriptionStatus,"))

	// No application: an empty files table that still has its CSV header.
	e2, err := dataexport.Collect(ctx, pool, "u2", now)
	require.NoError(t, err)
	last := e2.Tables[len(e2.Tables)-1]
	require.Equal(t, "doctor_verification_file", last.Name)
	require.Empty(t, last.Rows)
	require.NotContains(t, last.Columns, "storedName")
	require.Equal(t, "migraine-club-export-2026-03-01", dataexport.FileBaseName(now))
}
