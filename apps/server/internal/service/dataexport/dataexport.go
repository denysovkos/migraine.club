// Package dataexport is src/services/dataExport: the self-service copy of
// everything a user owns, as one JSON document or a ZIP of CSV files.
package dataexport

import (
	"context"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// FormatVersion is DATA_EXPORT_FORMAT_VERSION.
const FormatVersion = "1"

// Format is the export's format marker.
const Format = "migraine.club/user-data-export"

// Spec is ExportTableSpec: the column scoping rows to the user, and keys left
// out (credentials, payment-provider ids, staff-only moderation fields).
type Spec struct {
	Table, Owner string
	Omit         []string
}

// Tables is EXPORT_TABLES, in the same order. When adding a user-scoped
// table to the schema, add it here too.
var Tables = []Spec{
	{"user", "id", []string{"stripeCustomerId", "stripeSubscriptionId", "stripeSubscriptionPriceId"}},
	{"user_consent", "user_id", nil},
	{"intake_response", "user_id", nil},
	{"episode", "user_id", nil},
	{"episode_pain_reading", "user_id", nil},
	{"relief_session", "user_id", nil},
	{"daily_diary_entry", "user_id", nil},
	{"factor", "user_id", nil},
	{"factor_event", "user_id", nil},
	{"user_medications", "user_id", nil},
	{"medication_intakes", "user_id", nil},
	{"acute_doses", "user_id", nil},
	{"dose_outcomes", "user_id", nil},
	{"preventive_plan", "user_id", nil},
	{"preventive_intake_event", "user_id", nil},
	{"preventive_weekly_check_in", "user_id", nil},
	{"preventive_status_change", "user_id", nil},
	{"preventive_reminder_log", "user_id", nil},
	{"questionnaire_responses", "user_id", nil},
	{"user_outcome_settings", "user_id", nil},
	{"insight_test_plan", "user_id", nil},
	{"cycle_settings", "user_id", nil},
	{"cycle_bleeding_day", "user_id", nil},
	{"user_weather_settings", "user_id", nil},
	{"weather_pain_index_snapshot", "user_id", nil},
	{"risk_alert_run", "user_id", nil},
	{"program_settings", "user_id", nil},
	{"program_enrollment", "user_id", nil},
	{"program_adherence_event", "user_id", nil},
	{"program_recommendation_dismissal", "user_id", nil},
	{"program_notification_log", "user_id", nil},
	{"appointment_prep", "user_id", nil},
	{"doctor_share_link", "user_id", []string{"token"}},
	{"push_subscription", "user_id", []string{"endpoint", "p256dh", "auth"}},
	{"community_post", "author_id", nil},
	{"community_comment", "author_id", nil},
	{"community_vote", "user_id", nil},
	{"community_report", "reporter_id", []string{"resolvedBy"}},
	{"feature_request", "user_id", nil},
	{"doctor_verification_application", "user_id", []string{"reviewedByAdminId", "adminNotes"}},
	{"mcp_tool_call_audit", "user_id", nil},
}

// fileTable holds uploaded verification documents, owned through their
// application; their server-side storage location is left out.
const fileTable = "doctor_verification_file"

var fileOmit = []string{"storedName", "relativePath"}

// Row is one exported record: its values plus which keys held a JS Date.
type Row struct {
	Obj   *jsx.JSONObject
	Dates map[string]bool
}

// TableRows is one table of the export.
type TableRows struct {
	Name    string
	Columns []string
	Rows    []Row
}

// Export is UserDataExport.
type Export struct {
	ExportedAt time.Time
	UserID     string
	Tables     []TableRows
}

// Querier runs the export's reads.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func picked(meta q.Table, omit []string) (keys, cols []string) {
	for i, k := range meta.Keys {
		if !slices.Contains(omit, k) {
			keys = append(keys, k)
			cols = append(cols, meta.Columns[i])
		}
	}
	return keys, cols
}

var (
	timeType = reflect.TypeFor[jsontime.Time]()
	dateType = reflect.TypeFor[jsontime.Date]()
)

// dateKeys lists the model's keys Drizzle read as JS Dates.
func dateKeys(model any) map[string]bool {
	out := map[string]bool{}
	t := reflect.TypeOf(model)
	for i := range t.NumField() {
		f := t.Field(i)
		ft := f.Type
		if ft.Kind() == reflect.Pointer {
			ft = ft.Elem()
		}
		if ft == timeType || ft == dateType {
			out[strings.Split(f.Tag.Get("json"), ",")[0]] = true
		}
	}
	return out
}

func quoteIdent(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

func selectRows(ctx context.Context, db Querier, table string, omit []string, where string, arg any) (TableRows, error) {
	meta, ok := q.Tables[table]
	if !ok {
		return TableRows{}, fmt.Errorf("dataexport: unknown table %s", table)
	}
	keys, _ := picked(meta, omit)
	sql := "SELECT * FROM " + quoteIdent(table) + " WHERE " + where
	switch {
	case slices.Contains(keys, "createdAt"):
		sql += " ORDER BY " + quoteIdent(meta.Columns[slices.Index(meta.Keys, "createdAt")]) + " ASC"
	case slices.Contains(keys, "id"):
		sql += " ORDER BY " + quoteIdent(meta.Columns[slices.Index(meta.Keys, "id")]) + " ASC"
	}
	rows, err := db.Query(ctx, sql, arg)
	if err != nil {
		return TableRows{}, err
	}
	models, err := meta.Scan(rows)
	if err != nil {
		return TableRows{}, err
	}
	out := TableRows{Name: table, Columns: keys, Rows: make([]Row, 0, len(models))}
	for _, m := range models {
		b, err := q.MarshalKeys(m, keys)
		if err != nil {
			return TableRows{}, err
		}
		v, err := jsx.ParseJSON(b)
		if err != nil {
			return TableRows{}, err
		}
		out.Rows = append(out.Rows, Row{Obj: v.(*jsx.JSONObject), Dates: dateKeys(m)})
	}
	return out, nil
}

// Collect is collectUserData.
func Collect(ctx context.Context, db Querier, uid string, now time.Time) (*Export, error) {
	out := &Export{ExportedAt: now, UserID: uid}
	var appIDs []string
	for _, spec := range Tables {
		t, err := selectRows(ctx, db, spec.Table, spec.Omit, quoteIdent(spec.Owner)+" = $1", uid)
		if err != nil {
			return nil, err
		}
		if spec.Table == "doctor_verification_application" {
			for _, r := range t.Rows {
				if id, ok := r.Obj.Get("id"); ok {
					if s, ok := id.(string); ok {
						appIDs = append(appIDs, s)
					}
				}
			}
		}
		out.Tables = append(out.Tables, t)
	}
	if len(appIDs) > 0 {
		t, err := selectRows(ctx, db, fileTable, fileOmit, `"application_id" = ANY($1::uuid[])`, appIDs)
		if err != nil {
			return nil, err
		}
		out.Tables = append(out.Tables, t)
	} else {
		keys, _ := picked(q.Tables[fileTable], fileOmit)
		out.Tables = append(out.Tables, TableRows{Name: fileTable, Columns: keys})
	}
	return out, nil
}

// FileBaseName is exportFileBaseName.
func FileBaseName(now time.Time) string {
	return "migraine-club-export-" + now.UTC().Format("2006-01-02")
}

func (e *Export) object() *jsx.JSONObject {
	tables := jsx.NewJSONObject()
	for _, t := range e.Tables {
		rows := make([]any, len(t.Rows))
		for i, r := range t.Rows {
			rows[i] = r.Obj
		}
		tables.Set(t.Name, rows)
	}
	return jsx.NewJSONObject().Set("format", Format).Set("formatVersion", FormatVersion).
		Set("exportedAt", jsontime.Format(e.ExportedAt)).Set("userId", e.UserID).Set("tables", tables)
}

// JSON is serializeJsonExport.
func (e *Export) JSON() []byte { return jsx.Stringify(e.object(), "  ") }

// CountRows is countRows.
func (e *Export) CountRows() int {
	n := 0
	for _, t := range e.Tables {
		n += len(t.Rows)
	}
	return n
}
