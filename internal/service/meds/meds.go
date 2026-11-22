// Package meds holds the medication write paths: quick-add intakes
// (QuickAddService) and the acute-dose ledger (AcuteDoseService).
package meds

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/programs"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var jsSpace = regexp.MustCompile(`[\s\x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]+`)

// NormalizeName is normalizeName: trimmed, inner whitespace collapsed.
func NormalizeName(s string) string { return jsSpace.ReplaceAllString(jsx.Trim(s), " ") }

// Label is labelForUserMedication.
func Label(customName, canonicalName *string) string {
	raw := "Medication"
	switch {
	case customName != nil:
		raw = *customName
	case canonicalName != nil:
		raw = *canonicalName
	}
	return NormalizeName(raw)
}

// SanitizeNotes is sanitizeNotes: control characters become spaces,
// whitespace collapses, at most 500 code units; empty is null.
func SanitizeNotes(in *string) *string {
	if in == nil || *in == "" {
		return nil
	}
	var b strings.Builder
	for _, r := range *in {
		if r <= 31 || r == 127 {
			b.WriteByte(' ')
		} else {
			b.WriteRune(r)
		}
	}
	cleaned := NormalizeName(b.String())
	if cleaned == "" {
		return nil
	}
	out := jsx.Slice(cleaned, 0, 500)
	if !utf8.ValidString(out) {
		out = strings.ToValidUTF8(out, "�")
	}
	return &out
}

// Service is QuickAddService plus AcuteDoseService.
type Service struct {
	Q   *q.Queries
	Log *slog.Logger
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func optional[T any](v T, err error) (*T, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// Suggestions is getSuggestions.
func (s *Service) Suggestions(ctx context.Context, userID string) (*httpx.Object, error) {
	windowStart := s.now().Add(-90 * 24 * time.Hour)
	ongoing, err := optional(s.Q.OngoingEpisodeID(ctx, userID))
	if err != nil {
		return nil, err
	}
	hasOngoing := ongoing != nil
	top, err := s.Q.TopIntakeMeds(ctx, userID, jsontime.New(windowStart))
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, t := range top {
		if t.UserMedicationID != nil && *t.UserMedicationID != "" {
			ids = append(ids, *t.UserMedicationID)
		}
	}
	if len(ids) == 0 {
		return httpx.O("topMeds", []any{}, "hasOngoingEpisode", hasOngoing), nil
	}
	medsRows, err := s.Q.UserMedsWithCatalog(ctx, userID, ids)
	if err != nil {
		return nil, err
	}
	byID := map[string]q.UserMedsWithCatalogRow{}
	for _, m := range medsRows {
		byID[m.ID] = m
	}
	out := []any{}
	for _, agg := range top {
		if agg.UserMedicationID == nil {
			continue
		}
		med, ok := byID[*agg.UserMedicationID]
		if !ok {
			continue
		}
		intakes, err := s.Q.RecentIntakesForMed(ctx, userID, agg.UserMedicationID, jsontime.New(windowStart))
		if err != nil {
			return nil, err
		}
		dose, unit, custom := med.DefaultDose, med.DefaultUnit, med.DefaultUnitIsCustom
		empty := func() bool { return (dose == nil || *dose == "") && (unit == nil || *unit == "") }
		if empty() {
			if mode := mostCommon(intakes); mode != nil {
				dose, unit, custom = mode.Dose, mode.Unit, mode.UnitIsCustom
			}
		}
		if empty() {
			for _, r := range intakes {
				if (r.Dose != nil && *r.Dose != "") || (r.Unit != nil && *r.Unit != "") {
					dose, unit, custom = r.Dose, r.Unit, r.UnitIsCustom
					break
				}
			}
		}
		last := agg.LastUsedAt.Time
		out = append(out, httpx.O(
			"userMedicationId", *agg.UserMedicationID,
			"label", Label(med.CustomName, med.CanonicalName),
			"suggestedDose", dose, "suggestedUnit", unit, "unitIsCustom", custom,
			"lastUsedAt", jsontime.Format(last),
			"score", float64(agg.Count)*1_000_000+float64(last.UnixMilli()),
		))
	}
	return httpx.O("topMeds", out, "hasOngoingEpisode", hasOngoing), nil
}

// mostCommon is mostCommonDoseUnit: the most frequent (dose, unit, custom)
// triple, first seen wins ties (Array.prototype.sort is stable).
func mostCommon(rows []q.RecentIntakesForMedRow) *q.RecentIntakesForMedRow {
	type entry struct {
		row q.RecentIntakesForMedRow
		n   int
		idx int
	}
	counts := map[string]*entry{}
	var order []*entry
	for _, r := range rows {
		if (r.Dose == nil || *r.Dose == "") && (r.Unit == nil || *r.Unit == "") {
			continue
		}
		c := "0"
		if r.UnitIsCustom {
			c = "1"
		}
		k := deref(r.Dose) + "||" + deref(r.Unit) + "||" + c
		if e, ok := counts[k]; ok {
			e.n++
			continue
		}
		e := &entry{row: r, n: 1, idx: len(order)}
		counts[k] = e
		order = append(order, e)
	}
	if len(order) == 0 {
		return nil
	}
	sort.SliceStable(order, func(i, j int) bool { return order[i].n > order[j].n })
	return &order[0].row
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// IntakeInput is CreateQuickMedicationIntakeInput after parsing.
type IntakeInput struct {
	UserMedicationID    *string `json:"userMedicationId"`
	CatalogMedicationID *string `json:"catalogMedicationId"`
	CustomName          *string `json:"customName"`
	Dose                *string `json:"dose"`
	Unit                *string `json:"unit"`
	UnitIsCustom        *bool   `json:"unitIsCustom"`
	EpisodeID           *int64  `json:"episodeId"`
	TakenAt             *string `json:"takenAt"`
	RecordAcuteDose     *bool   `json:"recordAcuteDose"`
}

// IntakeSchema is CreateQuickMedicationIntakeSchema.
var IntakeSchema = zod.Refine(zod.Object(
	zod.F("userMedicationId", zod.Optional(zod.String().GUID())),
	zod.F("catalogMedicationId", zod.Optional(zod.String().GUID())),
	zod.F("customName", zod.Optional(zod.String().Trim().Min(1).Max(200))),
	zod.F("dose", zod.Optional(zod.String().Trim().Min(1).Max(100))),
	zod.F("unit", zod.Optional(zod.String().Trim().Min(1).Max(50))),
	zod.F("unitIsCustom", zod.Optional(zod.Boolean())),
	zod.F("episodeId", zod.Optional(zod.Number().Int().Positive())),
	zod.F("takenAt", zod.Optional(zod.String().Datetime())),
	zod.F("recordAcuteDose", zod.Optional(zod.Boolean())),
), func(v any) bool {
	m := v.(map[string]any)
	for _, k := range []string{"userMedicationId", "catalogMedicationId", "customName"} {
		if s, _ := m[k].(string); s != "" {
			return true
		}
	}
	return false
}, "userMedicationId, catalogMedicationId, or customName is required")

// UpdateIntakeSchema is UpdateMedicationIntakeSchema.
var UpdateIntakeSchema = zod.Object(
	zod.F("dose", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(100)))),
	zod.F("unit", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(50)))),
	zod.F("unitIsCustom", zod.Optional(zod.Boolean())),
	zod.F("takenAt", zod.Optional(zod.Nullable(zod.String().Datetime()))),
)

// Created is the result of CreateIntake.
type Created struct {
	IntakeID         string
	LinkedEpisodeID  *int32
	UserMedicationID string
}

// CreateIntake is createMedicationIntake. Errors with a plain message are
// what the route reports with status 500.
func (s *Service) CreateIntake(ctx context.Context, userID string, in IntakeInput) (Created, error) {
	takenAt := s.now()
	if in.TakenAt != nil && *in.TakenAt != "" {
		if t, err := jsontime.Parse(*in.TakenAt); err == nil {
			takenAt = t
		}
	}
	medID := ""
	if in.UserMedicationID != nil {
		medID = *in.UserMedicationID
	}
	if medID == "" && in.CatalogMedicationID != nil && *in.CatalogMedicationID != "" {
		id, err := optional(s.Q.UserMedForCatalog(ctx, userID, in.CatalogMedicationID))
		if err != nil {
			return Created{}, err
		}
		if id == nil {
			created, err := s.Q.InsertCatalogUserMed(ctx, userID, in.CatalogMedicationID)
			if err != nil {
				return Created{}, err
			}
			id = &created
		}
		medID = *id
	}
	if medID == "" && in.CustomName != nil && *in.CustomName != "" {
		name := NormalizeName(*in.CustomName)
		id, err := optional(s.Q.UserMedForCustomName(ctx, userID, name))
		if err != nil {
			return Created{}, err
		}
		if id == nil {
			created, err := s.Q.InsertCustomUserMed(ctx, userID, &name)
			if err != nil {
				return Created{}, err
			}
			id = &created
		}
		medID = *id
	}
	if medID == "" {
		return Created{}, errors.New("userMedicationId not resolved")
	}
	owned, err := optional(s.Q.OwnedUserMed(ctx, userID, medID))
	if err != nil {
		return Created{}, err
	}
	if owned == nil {
		return Created{}, errors.New("User medication not found")
	}

	var episodeID *int32
	if in.EpisodeID != nil && *in.EpisodeID != 0 {
		ep, err := s.ownedEpisode(ctx, userID, *in.EpisodeID)
		if err != nil {
			return Created{}, err
		}
		if ep == nil {
			return Created{}, errors.New("Episode not found")
		}
		episodeID = ep
	} else {
		ep, err := optional(s.Q.OngoingEpisodeIDAt(ctx, userID, jsontime.New(takenAt)))
		if err != nil {
			return Created{}, err
		}
		episodeID = ep
	}

	trimmed := func(p *string) *string {
		if p == nil || *p == "" {
			return nil
		}
		t := jsx.Trim(*p)
		return &t
	}
	dose, unit := trimmed(in.Dose), trimmed(in.Unit)
	custom := in.UnitIsCustom != nil && *in.UnitIsCustom
	id, err := s.Q.InsertMedicationIntake(ctx, q.InsertMedicationIntakeParams{
		UserID: userID, UserMedicationID: &medID, EpisodeID: episodeID, TakenAt: jsontime.New(takenAt),
		Dose: dose, Unit: unit, UnitIsCustom: custom,
	})
	if err != nil {
		return Created{}, err
	}
	// `x?.trim() || null`: empty after trimming is null too.
	nonEmpty := func(p *string) *string {
		if p == nil || *p == "" {
			return nil
		}
		return p
	}
	nd, nu := nonEmpty(dose), nonEmpty(unit)
	if err := s.Q.TouchUserMedLastUsed(ctx, q.TouchUserMedLastUsedParams{
		TakenAt: jsontime.Ptr(takenAt), Dose: nd, Unit: nu,
		SetUnitIsCustom: nd != nil || nu != nil, UnitIsCustom: custom,
		UserID: userID, ID: medID,
	}); err != nil {
		return Created{}, err
	}
	return Created{IntakeID: id, LinkedEpisodeID: episodeID, UserMedicationID: medID}, nil
}

// DeleteIntake is deleteMedicationIntake.
func (s *Service) DeleteIntake(ctx context.Context, userID, id string) (bool, error) {
	row, err := optional(s.Q.OwnedIntakeID(ctx, userID, id))
	if err != nil || row == nil {
		return false, err
	}
	return true, s.Q.DeleteIntake(ctx, userID, id)
}

// IntakePatch is UpdateMedicationIntakeInput; Set* tell present keys apart.
type IntakePatch struct {
	Dose, Unit       *string
	SetDose, SetUnit bool
	UnitIsCustom     *bool
	TakenAt          *time.Time
}

// ErrNoValues is drizzle's "No values to set", thrown when a patch is empty.
var ErrNoValues = errors.New("No values to set")

// UpdateIntake is updateMedicationIntake. "acute:" ids patch the acute-dose
// ledger, "intake:" (or bare) ids the intakes table.
func (s *Service) UpdateIntake(ctx context.Context, userID, id string, p IntakePatch) (bool, error) {
	isAcute := strings.HasPrefix(id, "acute:")
	raw := strings.TrimPrefix(strings.TrimPrefix(id, "acute:"), "intake:")
	var found *string
	var err error
	if isAcute {
		found, err = optional(s.Q.OwnedAcuteDoseID(ctx, userID, raw))
	} else {
		found, err = optional(s.Q.OwnedIntakeID(ctx, userID, raw))
	}
	if err != nil || found == nil {
		return false, err
	}
	if !p.SetDose && !p.SetUnit && p.UnitIsCustom == nil && p.TakenAt == nil {
		return false, ErrNoValues
	}
	var taken *jsontime.Time
	if p.TakenAt != nil {
		taken = jsontime.Ptr(*p.TakenAt)
	}
	custom := p.UnitIsCustom != nil && *p.UnitIsCustom
	if isAcute {
		return true, s.Q.PatchAcuteDose(ctx, q.PatchAcuteDoseParams{
			SetDose: p.SetDose, Dose: p.Dose, SetUnit: p.SetUnit, Unit: p.Unit,
			SetUnitIsCustom: p.UnitIsCustom != nil, UnitIsCustom: custom, TakenAt: taken, UserID: userID, ID: raw,
		})
	}
	return true, s.Q.PatchIntake(ctx, q.PatchIntakeParams{
		SetDose: p.SetDose, Dose: p.Dose, SetUnit: p.SetUnit, Unit: p.Unit,
		SetUnitIsCustom: p.UnitIsCustom != nil, UnitIsCustom: custom, TakenAt: taken, UserID: userID, ID: raw,
	})
}

// ---------- acute doses ----------

// DoseError is AcuteDoseError.
type DoseError struct{ Code, Message string }

func (e *DoseError) Error() string { return e.Message }

// DoseSchema is AcuteDoseSchema.
var DoseSchema = zod.Object(
	zod.F("medicationId", zod.String().GUID()),
	zod.F("attackId", zod.Optional(zod.Nullable(zod.Number().Int().Positive()))),
	zod.F("takenAt", zod.Optional(zod.String().Datetime())),
	zod.F("dose", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(100)))),
	zod.F("unit", zod.Optional(zod.Nullable(zod.String().Trim().Min(1).Max(50)))),
	zod.F("unitIsCustom", zod.Optional(zod.Boolean())),
	zod.F("notes", zod.Optional(zod.Nullable(zod.String().Max(1000)))),
)

// sqlOwnedEpisode is the ownership check Drizzle reported on failure.
const sqlOwnedEpisode = `select "id" from "episode" where ("episode"."user_id" = $1 and "episode"."id" = $2) limit $3`

// ownedEpisode is the user's episode id, nil when there is none. An id
// beyond int4 fails as the Postgres query did, with Drizzle's message.
func (s *Service) ownedEpisode(ctx context.Context, userID string, raw int64) (*int32, error) {
	id, err := db.Int4(raw)
	if err == nil {
		var ep *int32
		ep, err = optional(s.Q.OwnedEpisodeID(ctx, userID, id))
		if err == nil {
			return ep, nil
		}
	}
	return nil, db.Drizzle(err, sqlOwnedEpisode, userID, float64(raw), 1)
}

// DoseInput is AcuteDoseInput.
type DoseInput struct {
	MedicationID string  `json:"medicationId"`
	AttackID     *int64  `json:"attackId"`
	TakenAt      *string `json:"takenAt"`
	Dose         *string `json:"dose"`
	Unit         *string `json:"unit"`
	UnitIsCustom *bool   `json:"unitIsCustom"`
	Notes        *string `json:"notes"`
}

// CreateDose is AcuteDoseService.create: the MOH-relevant write path.
func (s *Service) CreateDose(ctx context.Context, userID string, in DoseInput) (doseID string, attackID *int32, err error) {
	ok, err := consent.HasHealthDataConsent(ctx, s.Q, userID)
	if err != nil {
		return "", nil, err
	}
	if !ok {
		return "", nil, &DoseError{"CONSENT_REQUIRED", "Health data consent required"}
	}
	med, err := optional(s.Q.OwnedUserMed(ctx, userID, in.MedicationID))
	if err != nil {
		return "", nil, err
	}
	if med == nil {
		return "", nil, &DoseError{"MEDICATION_NOT_FOUND", "Medication not found"}
	}
	if in.AttackID != nil && *in.AttackID != 0 {
		ep, err := s.ownedEpisode(ctx, userID, *in.AttackID)
		if err != nil {
			return "", nil, err
		}
		if ep == nil {
			return "", nil, &DoseError{"ATTACK_NOT_FOUND", "Attack not found"}
		}
		attackID = ep
	}
	takenAt := s.now()
	if in.TakenAt != nil && *in.TakenAt != "" {
		if t, err := jsontime.Parse(*in.TakenAt); err == nil {
			takenAt = t
		}
	}
	id, err := s.Q.InsertAcuteDose(ctx, q.InsertAcuteDoseParams{
		UserID: userID, MedicationID: med.ID, AttackID: attackID, TakenAt: jsontime.New(takenAt),
		Dose: in.Dose, Unit: in.Unit, UnitIsCustom: in.UnitIsCustom != nil && *in.UnitIsCustom,
		Notes: SanitizeNotes(in.Notes),
	})
	if err != nil {
		return "", nil, err
	}
	s.Log.Info("Acute dose logged", "userId", userID, "acuteDoseId", id)
	if attackID != nil {
		a := *attackID
		go func() {
			if err := programs.RecordAcuteAdherence(context.WithoutCancel(ctx), s.Q, userID, a, ""); err != nil {
				s.Log.Warn("Failed to record acute adherence", "userId", userID, "attackId", a, "error", err)
			}
		}()
	}
	return id, attackID, nil
}
