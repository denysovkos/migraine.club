package meds

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// MedicationClasses is MedicationClass.
var MedicationClasses = []string{"triptan", "ergotamine", "combination_analgesic", "opioid", "non_opioid_simple_analgesic"}

// CreateUserMedSchema is CreateUserMedicationSchema.
var CreateUserMedSchema = zod.Refine(zod.Object(
	zod.F("catalogMedicationId", zod.Optional(zod.String().GUID())),
	zod.F("customName", zod.Optional(zod.String().Trim().Min(1).Max(200))),
	zod.F("defaultDose", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(100)))),
	zod.F("defaultUnit", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(50)))),
	zod.F("defaultUnitIsCustom", zod.Optional(zod.Boolean())),
	zod.F("medicationClass", zod.Optional(zod.Enum(MedicationClasses...))),
	zod.F("isAcute", zod.Optional(zod.Boolean())),
	zod.F("isPinned", zod.Optional(zod.Boolean())),
), func(v any) bool {
	m := v.(map[string]any)
	a, _ := m["catalogMedicationId"].(string)
	b, _ := m["customName"].(string)
	return a != "" || b != ""
}, "catalogMedicationId or customName is required")

// UpdateUserMedSchema is UpdateUserMedicationSchema.
var UpdateUserMedSchema = zod.Object(
	zod.F("defaultDose", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(100)))),
	zod.F("defaultUnit", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(50)))),
	zod.F("defaultUnitIsCustom", zod.Optional(zod.Boolean())),
	zod.F("medicationClass", zod.Optional(zod.Enum(MedicationClasses...))),
	zod.F("isAcute", zod.Optional(zod.Boolean())),
	zod.F("isPinned", zod.Optional(zod.Boolean())),
)

// Catalog reads and writes a user's medication list. It uses pgx directly:
// the list shapes and the search's OR-list are built per request.
type Catalog struct {
	Pool *pgxpool.Pool
	Now  func() time.Time
}

func (c *Catalog) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

const medCols = `um.id, coalesce(um.custom_name, mc.canonical_name) AS label, um.default_dose, um.default_unit, um.default_unit_is_custom,
	um.last_used_dose, um.last_used_unit, um.last_used_unit_is_custom, um.last_used_at`

type medRow struct {
	ID                   string
	Label                *string
	DefaultDose          *string
	DefaultUnit          *string
	DefaultUnitIsCustom  bool
	LastUsedDose         *string
	LastUsedUnit         *string
	LastUsedUnitIsCustom bool
	LastUsedAt           *jsontime.Time
	MedicationClass      string
	IsAcute              bool
	IsPinned             bool
	CreatedAt            jsontime.Time
}

func (r medRow) base() *httpx.Object {
	return httpx.O("id", r.ID, "label", r.Label, "defaultDose", r.DefaultDose, "defaultUnit", r.DefaultUnit,
		"defaultUnitIsCustom", r.DefaultUnitIsCustom, "lastUsedDose", r.LastUsedDose, "lastUsedUnit", r.LastUsedUnit,
		"lastUsedUnitIsCustom", r.LastUsedUnitIsCustom, "lastUsedAt", r.LastUsedAt)
}

// List is GET /api/user-medications: pinned, recently used and all.
func (c *Catalog) List(ctx context.Context, userID string) (*httpx.Object, error) {
	from := ` FROM user_medications um LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id `
	scanFull := func(rows pgx.Rows, withCreated bool) ([]medRow, error) {
		defer rows.Close()
		var out []medRow
		for rows.Next() {
			var r medRow
			dest := []any{&r.ID, &r.Label, &r.DefaultDose, &r.DefaultUnit, &r.DefaultUnitIsCustom, &r.LastUsedDose,
				&r.LastUsedUnit, &r.LastUsedUnitIsCustom, &r.LastUsedAt, &r.MedicationClass, &r.IsAcute, &r.IsPinned}
			if withCreated {
				dest = append(dest, &r.CreatedAt)
			}
			if err := rows.Scan(dest...); err != nil {
				return nil, err
			}
			out = append(out, r)
		}
		return out, rows.Err()
	}

	rows, err := c.Pool.Query(ctx, `SELECT `+medCols+`, um.medication_class, um.is_acute, um.is_pinned, um.created_at`+from+
		`WHERE um.user_id = $1 AND um.is_pinned = true ORDER BY um.created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	pinnedRows, err := scanFull(rows, true)
	if err != nil {
		return nil, err
	}
	pinned := make([]any, len(pinnedRows))
	for i, r := range pinnedRows {
		pinned[i] = r.base().Set("medicationClass", r.MedicationClass).Set("isAcute", r.IsAcute).
			Set("isPinned", r.IsPinned).Set("createdAt", r.CreatedAt)
	}

	aggRows, err := c.Pool.Query(ctx, `SELECT user_medication_id FROM medication_intakes
		WHERE user_id = $1 AND taken_at >= $2 GROUP BY user_medication_id ORDER BY max(taken_at) DESC LIMIT 30`,
		userID, c.now().Add(-90*24*time.Hour))
	if err != nil {
		return nil, err
	}
	var ids []string
	for aggRows.Next() {
		var id *string
		if err := aggRows.Scan(&id); err != nil {
			aggRows.Close()
			return nil, err
		}
		if id != nil && *id != "" {
			ids = append(ids, *id)
		}
	}
	aggRows.Close()
	recent := []any{}
	if len(ids) > 0 {
		rows, err := c.Pool.Query(ctx, `SELECT `+medCols+`, um.medication_class, um.is_acute, um.is_pinned`+from+
			`WHERE um.user_id = $1 AND um.id = ANY($2::uuid[])`, userID, ids)
		if err != nil {
			return nil, err
		}
		got, err := scanFull(rows, false)
		if err != nil {
			return nil, err
		}
		order := map[string]int{}
		for i, id := range ids {
			order[id] = i
		}
		// [...].sort((a, b) => order(a) - order(b)): stable by first-seen index.
		sortStable(got, func(a, b medRow) bool { return order[a.ID] < order[b.ID] })
		for _, r := range got {
			recent = append(recent, r.base().Set("medicationClass", r.MedicationClass).Set("isAcute", r.IsAcute).Set("isPinned", r.IsPinned))
		}
	}

	rows, err = c.Pool.Query(ctx, `SELECT `+medCols+`, um.medication_class, um.is_acute, um.is_pinned`+from+
		`WHERE um.user_id = $1 ORDER BY um.is_pinned DESC, um.last_used_at DESC, um.created_at DESC LIMIT 400`, userID)
	if err != nil {
		return nil, err
	}
	allRows, err := scanFull(rows, false)
	if err != nil {
		return nil, err
	}
	all := make([]any, len(allRows))
	for i, r := range allRows {
		all[i] = r.base().Set("isPinned", r.IsPinned)
	}
	return httpx.O("pinned", pinned, "recentlyUsed", recent, "all", all), nil
}

func sortStable(rows []medRow, less func(a, b medRow) bool) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && less(rows[j], rows[j-1]); j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

// CreateInput is the parsed CreateUserMedicationSchema body.
type CreateInput struct {
	CatalogMedicationID *string `json:"catalogMedicationId"`
	CustomName          *string `json:"customName"`
	DefaultDose         *string `json:"defaultDose"`
	DefaultUnit         *string `json:"defaultUnit"`
	DefaultUnitIsCustom *bool   `json:"defaultUnitIsCustom"`
	MedicationClass     *string `json:"medicationClass"`
	IsAcute             *bool   `json:"isAcute"`
	IsPinned            *bool   `json:"isPinned"`
}

// Create returns (id, created).
func (c *Catalog) Create(ctx context.Context, userID string, in CreateInput) (string, bool, error) {
	var custom *string
	if in.CustomName != nil && *in.CustomName != "" {
		n := NormalizeName(*in.CustomName)
		custom = &n
	}
	var existing string
	var err error
	if in.CatalogMedicationID != nil && *in.CatalogMedicationID != "" {
		err = c.Pool.QueryRow(ctx, `SELECT id FROM user_medications WHERE user_id = $1 AND catalog_medication_id = $2 LIMIT 1`, userID, *in.CatalogMedicationID).Scan(&existing)
	} else {
		name := ""
		if custom != nil {
			name = *custom
		}
		err = c.Pool.QueryRow(ctx, `SELECT id FROM user_medications WHERE user_id = $1 AND lower(custom_name) = lower($2) LIMIT 1`, userID, name).Scan(&existing)
	}
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}
	class := "non_opioid_simple_analgesic"
	if in.MedicationClass != nil {
		class = *in.MedicationClass
	}
	bv := func(p *bool, def bool) bool {
		if p == nil {
			return def
		}
		return *p
	}
	var id string
	err = c.Pool.QueryRow(ctx, `INSERT INTO user_medications (user_id, catalog_medication_id, custom_name, default_dose, default_unit,
		default_unit_is_custom, medication_class, is_acute, is_pinned) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
		userID, in.CatalogMedicationID, custom, in.DefaultDose, in.DefaultUnit, bv(in.DefaultUnitIsCustom, false), class,
		bv(in.IsAcute, true), bv(in.IsPinned, false)).Scan(&id)
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// Update applies the present keys of a parsed UpdateUserMedicationSchema
// body. ok is false when the medication is not the user's.
func (c *Catalog) Update(ctx context.Context, userID, id string, patch map[string]any) (bool, error) {
	var found string
	err := c.Pool.QueryRow(ctx, `SELECT id FROM user_medications WHERE user_id = $1 AND id = $2 LIMIT 1`, userID, id).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	cols := map[string]string{"defaultDose": "default_dose", "defaultUnit": "default_unit", "defaultUnitIsCustom": "default_unit_is_custom",
		"medicationClass": "medication_class", "isAcute": "is_acute", "isPinned": "is_pinned"}
	var sets []string
	args := []any{userID, id}
	for _, k := range []string{"defaultDose", "defaultUnit", "defaultUnitIsCustom", "medicationClass", "isAcute", "isPinned"} {
		v, ok := patch[k]
		if !ok {
			continue
		}
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", cols[k], len(args)))
	}
	if len(sets) == 0 {
		return false, ErrNoValues
	}
	_, err = c.Pool.Exec(ctx, `UPDATE user_medications SET `+strings.Join(sets, ", ")+` WHERE user_id = $1 AND id = $2`, args...)
	return true, err
}

// Search is GET /api/medications/search.
func (c *Catalog) Search(ctx context.Context, userID, rawQuery string) (*httpx.Object, error) {
	query := NormalizeName(rawQuery)
	if query == "" {
		return httpx.O("results", []any{}), nil
	}
	lang := "en"
	var pref string
	err := c.Pool.QueryRow(ctx, `SELECT preferred_language FROM "user" WHERE id = $1 LIMIT 1`, userID).Scan(&pref)
	switch {
	case err == nil:
		lang = pref
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	langFilter := `mc.canonical_name !~ '[А-Яа-яЁёІіЇїЄєҐґ]'`
	if lang == "uk" {
		langFilter = `mc.canonical_name ~ '[А-Яа-яЁёІіЇїЄєҐґ]'`
	}
	var alt []string
	if ContainsCyrillic(query) {
		for _, v := range CyrillicToLatinVariants(query, 3) {
			if v != "" && v != query && len(alt) < 2 {
				alt = append(alt, v)
			}
		}
	}

	args := []any{userID, "%" + query + "%"}
	ors := []string{"um.custom_name ILIKE $2", "mc.search_text ILIKE $2"}
	for _, v := range alt {
		args = append(args, "%"+v+"%")
		ors = append(ors, fmt.Sprintf("um.custom_name ILIKE $%d", len(args)))
	}
	for i := range alt {
		ors = append(ors, fmt.Sprintf("mc.search_text ILIKE $%d", 3+i))
	}
	rows, err := c.Pool.Query(ctx, `SELECT um.id, um.catalog_medication_id, coalesce(um.custom_name, mc.canonical_name),
		um.default_dose, um.default_unit, um.default_unit_is_custom, um.last_used_dose, um.last_used_unit,
		um.last_used_unit_is_custom, um.is_pinned
		FROM user_medications um LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
		WHERE um.user_id = $1 AND (`+strings.Join(ors, " OR ")+`)
		ORDER BY um.is_pinned DESC, um.created_at DESC LIMIT 20`, args...)
	if err != nil {
		return nil, err
	}
	var results []any
	owned := map[string]bool{}
	for rows.Next() {
		var id string
		var catalogID, label, dd, du, lud, luu *string
		var ddc, luc, pinned bool
		if err := rows.Scan(&id, &catalogID, &label, &dd, &du, &ddc, &lud, &luu, &luc, &pinned); err != nil {
			rows.Close()
			return nil, err
		}
		if catalogID != nil && *catalogID != "" {
			owned[*catalogID] = true
		}
		results = append(results, httpx.O("kind", "user", "userMedicationId", id, "catalogMedicationId", catalogID,
			"label", label, "defaultDose", dd, "defaultUnit", du, "defaultUnitIsCustom", ddc,
			"lastUsedDose", lud, "lastUsedUnit", luu, "lastUsedUnitIsCustom", luc, "isPinned", pinned))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	qs := append([]string{query}, alt...)
	cargs := []any{}
	param := func(v any) string { cargs = append(cargs, v); return fmt.Sprintf("$%d", len(cargs)) }
	var sims []string
	for _, v := range qs[:min(3, len(qs))] {
		sims = append(sims, "similarity(mc.search_text, "+param(v)+")")
	}
	score := sims[0]
	if len(sims) > 1 {
		score = "greatest(" + strings.Join(sims, ", ") + ")"
	}
	cors := []string{"mc.search_text ILIKE " + param("%"+query+"%"), "mc.search_text % " + param(query)}
	for _, v := range alt {
		cors = append(cors, "mc.search_text ILIKE "+param("%"+v+"%"))
	}
	for _, v := range alt {
		cors = append(cors, "mc.search_text % "+param(v))
	}
	crows, err := c.Pool.Query(ctx, `SELECT mc.id, mc.canonical_name FROM medications_catalog mc
		WHERE `+langFilter+` AND (`+strings.Join(cors, " OR ")+`)
		ORDER BY `+score+` DESC, mc.canonical_name LIMIT 20`, cargs...)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var id, label string
		if err := crows.Scan(&id, &label); err != nil {
			return nil, err
		}
		if owned[id] {
			continue
		}
		results = append(results, httpx.O("kind", "catalog", "catalogMedicationId", id, "label", label))
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}
	if len(results) > 20 {
		results = results[:20]
	}
	if results == nil {
		results = []any{}
	}
	return httpx.O("results", results), nil
}
