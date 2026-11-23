// Package appointmentprep is src/services/appointmentPrep: visit drafts with a
// generated snapshot of recent burden.
package appointmentprep

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/outcomes"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// ErrNotFound is "Appointment prep draft not found".
var ErrNotFound = errors.New("Appointment prep draft not found")

// sqlGetDraft is getDraft's statement as Drizzle reported it.
const sqlGetDraft = `select "id", "appointment_date", "visit_label", "clinician_name", "visit_reason", "top_concerns", ` +
	`"doctor_questions", "personal_notes", "compare_window_days", "generated_snapshot", "created_at", "updated_at" ` +
	`from "appointment_prep" where ("appointment_prep"."user_id" = $1 and "appointment_prep"."id" = $2) limit $3`

// defaultSnapshot is mapDraftRow's fallback for a missing snapshot.
func defaultSnapshot(window int32) *httpx.Object {
	return httpx.O("compareWindowDays", window,
		"coverage", httpx.O("totalDays", 0, "recordedDays", 0, "missingDays", 0),
		"attackStats", httpx.O("totalAttacks", 0, "avgIntensity", nil),
		"currentSnapshot", httpx.O("headacheBurden", httpx.O("migraineDays", 0, "headacheDays", 0),
			"acuteMedicationDays", 0, "preventiveNames", []any{},
			"questionnaireScores", httpx.O("hit6", nil, "midas", nil)),
		"whatChangedKeys", []any{}, "questionPromptKeys", []any{})
}

func arr(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return []any{}
	}
	return raw
}

// Draft is mapDraftRow; withSnapshot adds generatedSnapshot.
func Draft(r q.AppointmentPrep, withSnapshot bool) *httpx.Object {
	o := httpx.O("id", r.ID, "appointmentDate", r.AppointmentDate.YMD(), "visitLabel", r.VisitLabel,
		"clinicianName", r.ClinicianName, "visitReason", r.VisitReason, "topConcerns", arr(r.TopConcerns),
		"doctorQuestions", arr(r.DoctorQuestions), "personalNotes", r.PersonalNotes, "compareWindowDays", r.CompareWindowDays)
	if withSnapshot {
		if len(r.GeneratedSnapshot) == 0 || string(r.GeneratedSnapshot) == "null" {
			o.Set("generatedSnapshot", defaultSnapshot(r.CompareWindowDays))
		} else {
			o.Set("generatedSnapshot", r.GeneratedSnapshot)
		}
	}
	return o.Set("createdAt", jsontime.Format(r.CreatedAt.Time)).Set("updatedAt", jsontime.Format(r.UpdatedAt.Time))
}

// Service is AppointmentPrepService.
type Service struct {
	Q   *q.Queries
	Now func() time.Time
}

// List is listDrafts.
func (s *Service) List(ctx context.Context, uid string) ([]any, error) {
	rows, err := s.Q.ListAppointmentPreps(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = Draft(r, false)
	}
	return out, nil
}

// Get is getDraft; nil when missing. A malformed id fails like Drizzle did.
func (s *Service) Get(ctx context.Context, uid, id string) (*q.AppointmentPrep, error) {
	r, err := s.Q.GetAppointmentPrep(ctx, uid, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, db.Drizzle(err, sqlGetDraft, uid, id, 1)
	}
	return &r, nil
}

// normalizeText trims and turns "" into null.
func normalizeText(v *string) *string {
	if v == nil {
		return nil
	}
	t := jsx.Trim(*v)
	if t == "" {
		return nil
	}
	return &t
}

// Input is the draft body after parsing; nil pointers are absent or null.
type Input struct {
	AppointmentDate                        string
	VisitLabel, ClinicianName, VisitReason *string
	PersonalNotes                          *string
	TopConcerns, DoctorQuestions           []string
	CompareWindowDays                      int
}

func strArr(v []string) json.RawMessage {
	if v == nil {
		v = []string{}
	}
	b, _ := httpx.Marshal(v)
	return b
}

// Create is createDraft.
func (s *Service) Create(ctx context.Context, uid string, in Input) (string, error) {
	window := in.CompareWindowDays
	if window == 0 {
		window = 90
	}
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return "", err
	}
	loc := tz.LoadOrUTC(zone)
	toDay := localdate.StartOfDay(s.Now(), loc)
	fromDay := time.Date(toDay.Year(), toDay.Month(), toDay.Day()-(window-1), 0, 0, 0, 0, loc)
	toExcl := time.Date(toDay.Year(), toDay.Month(), toDay.Day()+1, 0, 0, 0, 0, loc)
	fromYMD, toYMD := fromDay.Format(localdate.Layout), toDay.Format(localdate.Layout)
	dbd := func(ymd string) jsontime.Date { t, _ := time.Parse(localdate.Layout, ymd); return jsontime.NewDate(t) }

	diary, err := s.Q.PrepDiaryRows(ctx, uid, dbd(fromYMD), dbd(toYMD))
	if err != nil {
		return "", err
	}
	intakes, err := s.Q.PrepIntakeRows(ctx, uid, jsontime.New(fromDay), jsontime.New(toExcl))
	if err != nil {
		return "", err
	}
	quests, err := s.Q.PrepQuestionnaires(ctx, uid)
	if err != nil {
		return "", err
	}
	prevNames, err := s.Q.PrepPreventiveNames(ctx, uid)
	if err != nil {
		return "", err
	}
	intensities, err := s.Q.PrepEpisodeIntensities(ctx, uid, jsontime.New(fromDay), jsontime.New(toExcl))
	if err != nil {
		return "", err
	}

	days := make([]outcomes.DiaryDay, len(diary))
	for i, d := range diary {
		days[i] = outcomes.DiaryDay{LocalDate: d.LocalDate.YMD(), DayType: d.DayType}
	}
	meds := make([]outcomes.MedicationIntake, len(intakes))
	for i, m := range intakes {
		name := ""
		for _, p := range []*string{m.MedicationName, m.CustomName, m.CanonicalName} {
			if p != nil {
				name = *p
				break
			}
		}
		meds[i] = outcomes.MedicationIntake{TakenAt: m.TakenAt.Time, Name: jsx.Trim(name)}
	}
	res := outcomes.ComputeForRange(zone, window, fromYMD, toYMD, days, meds)

	score := func(kind string) any {
		for _, r := range quests {
			if r.Type == kind {
				if r.ScoreTotal == nil {
					return nil
				}
				return *r.ScoreTotal
			}
		}
		return nil
	}
	names := []string{}
	for _, n := range prevNames {
		if t := normalizeText(&n); t != nil {
			names = append(names, *t)
		}
	}
	var avg any
	if len(intensities) > 0 {
		sum := 0.0
		for _, v := range intensities {
			sum += float64(v)
		}
		avg = jsx.Round(sum / float64(len(intensities)))
	}
	t := res.Totals
	snapshot := httpx.O("compareWindowDays", window,
		"coverage", t.Coverage,
		"attackStats", httpx.O("totalAttacks", len(intensities), "avgIntensity", avg),
		"currentSnapshot", httpx.O("headacheBurden", httpx.O("migraineDays", t.MmdMin, "headacheDays", t.MhdMin),
			"acuteMedicationDays", t.AcuteMedicationDays, "preventiveNames", names,
			"questionnaireScores", httpx.O("hit6", score("HIT6"), "midas", score("MIDAS"))),
		"whatChangedKeys", []string{"coverage_summary", "attack_summary"},
		"questionPromptKeys", []string{"treatment_adjustment", "acute_medication_safety"})
	snap, _ := httpx.Marshal(snapshot)

	date, err := localdate.JSDateFromYMD(in.AppointmentDate)
	if err != nil {
		return "", err
	}
	return s.Q.InsertAppointmentPrep(ctx, q.InsertAppointmentPrepParams{
		UserID: uid, AppointmentDate: jsontime.NewDate(date), VisitLabel: normalizeText(in.VisitLabel),
		ClinicianName: normalizeText(in.ClinicianName), VisitReason: normalizeText(in.VisitReason),
		TopConcerns: strArr(in.TopConcerns), DoctorQuestions: strArr(in.DoctorQuestions),
		PersonalNotes: normalizeText(in.PersonalNotes), CompareWindowDays: int32(window), GeneratedSnapshot: snap,
	})
}

// Patch is UpdateAppointmentPrepDraftInput; Set* mark keys present.
type Patch struct {
	AppointmentDate                                                   *string
	VisitLabel, ClinicianName, VisitReason, PersonalNotes             *string
	SetVisitLabel, SetClinicianName, SetVisitReason, SetPersonalNotes bool
	TopConcerns, DoctorQuestions                                      []string
	SetTopConcerns, SetDoctorQuestions                                bool
}

// Update is updateDraft; it returns the updated row.
func (s *Service) Update(ctx context.Context, uid, id string, p Patch) (*q.AppointmentPrep, error) {
	existing, err := s.Get(ctx, uid, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrNotFound
	}
	params := q.UpdateAppointmentPrepParams{
		SetVisitLabel: p.SetVisitLabel, VisitLabel: normalizeText(p.VisitLabel),
		SetClinicianName: p.SetClinicianName, ClinicianName: normalizeText(p.ClinicianName),
		SetVisitReason: p.SetVisitReason, VisitReason: normalizeText(p.VisitReason),
		SetPersonalNotes: p.SetPersonalNotes, PersonalNotes: normalizeText(p.PersonalNotes),
		Now: jsontime.New(s.Now()), UserID: uid, ID: id,
	}
	if p.AppointmentDate != nil && *p.AppointmentDate != "" {
		d, err := localdate.JSDateFromYMD(*p.AppointmentDate)
		if err != nil {
			return nil, err
		}
		params.AppointmentDate = jsontime.NewDate(d)
	}
	if p.SetTopConcerns {
		params.TopConcerns = strArr(p.TopConcerns)
	}
	if p.SetDoctorQuestions {
		params.DoctorQuestions = strArr(p.DoctorQuestions)
	}
	if err := s.Q.UpdateAppointmentPrep(ctx, params); err != nil {
		return nil, err
	}
	updated, err := s.Get(ctx, uid, id)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, ErrNotFound
	}
	return updated, nil
}

// Delete is deleteDraft.
func (s *Service) Delete(ctx context.Context, uid, id string) error {
	existing, err := s.Get(ctx, uid, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return ErrNotFound
	}
	return s.Q.DeleteAppointmentPrep(ctx, uid, id)
}
