package share

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/tz"
)

func codeError(w http.ResponseWriter, status int, msg, code string) {
	httpx.JSON(w, status, httpx.O("error", msg, "code", code))
}

// PainLevel is normalizeToPainLevel for an integer intensity.
func PainLevel(v int32) any {
	switch {
	case v >= 1 && v <= 5:
		return v
	case v == 6:
		return 3
	case v >= 7 && v <= 8:
		return 4
	case v >= 9 && v <= 10:
		return 5
	}
	return nil
}

// sharedEpisode is SharedEpisode plus the values calculateSummary reads.
type sharedEpisode struct {
	obj       *httpx.Object
	start     time.Time
	end       *time.Time
	ongoing   bool
	intensity any
	symptoms  []any
	triggers  []any
	medLabels []string
}

func parseRaw(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	v, err := jsx.ParseJSON(raw)
	if err != nil {
		return nil
	}
	return v
}

// orEmpty is `value || []`: falsy JSON becomes an empty array.
func orEmpty(v any) any {
	if !truthy(v) {
		return []any{}
	}
	return v
}

var weatherKeys = []string{"wpiScore", "wpiLevel", "kpIndex", "deltaPressure", "humidity"}

// weather picks the five keys the share view exposes; missing keys were
// undefined and so left out of the JSON.
func weather(raw json.RawMessage) any {
	v := parseRaw(raw)
	if !truthy(v) {
		return nil
	}
	out := jsx.NewJSONObject()
	if o, ok := v.(*jsx.JSONObject); ok {
		for _, k := range weatherKeys {
			if x, ok := o.Get(k); ok {
				out.Set(k, x)
			}
		}
	}
	return out
}

func firstName(ps ...*string) string {
	for _, p := range ps {
		if p != nil {
			return *p
		}
	}
	return ""
}

// errNotIterable is the TypeError calculateSummary threw for symptoms or
// triggers that were not arrays.
var errNotIterable = errors.New("forEach is not a function")

func (h handlers) episodes(ctx context.Context, uid string, start, end *jsontime.Time) ([]sharedEpisode, error) {
	rows, err := h.d.Q.ShareEpisodes(ctx, uid, start, end)
	if err != nil {
		return nil, err
	}
	ids := make([]int32, len(rows))
	for i, e := range rows {
		ids[i] = e.ID
	}
	byEpisode := map[int32][]any{}
	labels := map[int32][]string{}
	if len(ids) > 0 {
		intakes, err := h.d.Q.ShareIntakes(ctx, uid, ids)
		if err != nil {
			return nil, err
		}
		for _, mi := range intakes {
			if mi.EpisodeID == nil || *mi.EpisodeID == 0 {
				continue
			}
			label := jsx.Trim(firstName(mi.MedicationName, mi.CustomName, mi.CanonicalName))
			if label == "" {
				label = "Medication"
			}
			byEpisode[*mi.EpisodeID] = append(byEpisode[*mi.EpisodeID], httpx.O("label", label, "dose", mi.Dose,
				"unit", mi.Unit, "takenAt", jsontime.Format(mi.TakenAt.Time)))
			labels[*mi.EpisodeID] = append(labels[*mi.EpisodeID], label)
		}
	}
	out := make([]sharedEpisode, len(rows))
	for i, ep := range rows {
		attack := "migraine"
		if ep.AttackType == "headache" {
			attack = "headache"
		}
		var end any
		var endT *time.Time
		if ep.EndTime != nil && !ep.EndTime.IsZero() {
			end = jsontime.Format(ep.EndTime.Time)
			t := ep.EndTime.Time
			endT = &t
		}
		meds := byEpisode[ep.ID]
		if meds == nil {
			meds = []any{}
		}
		symptoms, triggers := orEmpty(parseRaw(ep.Symptoms)), orEmpty(parseRaw(ep.Triggers))
		intensity := PainLevel(ep.Intensity)
		obj := httpx.O("id", ep.ID, "attackType", attack, "startTime", jsontime.Format(ep.StartTime.Time), "endTime", end,
			"isOngoing", ep.IsOngoing, "intensity", intensity, "painLocation", ep.PainLocation,
			"painLocationOther", ep.PainLocationOther, "painType", ep.PainType, "painTypeOther", ep.PainTypeOther,
			"symptoms", symptoms, "symptomsOther", ep.SymptomsOther, "medicationIntakes", meds,
			"triggers", triggers, "triggersOther", ep.TriggersOther, "notes", ep.Notes, "weatherContext", weather(ep.WeatherContext))
		s, sOK := symptoms.([]any)
		t, tOK := triggers.([]any)
		if !sOK || !tOK {
			return nil, errNotIterable
		}
		out[i] = sharedEpisode{obj: obj, start: ep.StartTime.Time, end: endT, ongoing: ep.IsOngoing,
			intensity: intensity, symptoms: s, triggers: t, medLabels: labels[ep.ID]}
	}
	return out, nil
}

func (h handlers) view(w http.ResponseWriter, r *http.Request) {
	token, err := url.PathUnescape(chi.URLParam(r, "token"))
	if err != nil {
		token = chi.URLParam(r, "token")
	}
	if len(jsx.CharCodes(token)) < 20 {
		codeError(w, http.StatusBadRequest, "Invalid token", "INVALID_TOKEN")
		return
	}
	body, err := h.shared(r.Context(), token)
	if err != nil {
		var se statusError
		if errors.As(err, &se) {
			codeError(w, se.status, se.msg, se.code)
			return
		}
		h.d.Log.Error("Error fetching shared data", "error", err)
		codeError(w, http.StatusInternalServerError, "Failed to fetch data", "SERVER_ERROR")
		return
	}
	httpx.JSON(w, http.StatusOK, body)
}

type statusError struct {
	status    int
	msg, code string
}

func (e statusError) Error() string { return fmt.Sprintf("%d %s", e.status, e.code) }

func (h handlers) shared(ctx context.Context, token string) (*httpx.Object, error) {
	link, err := h.d.Q.ShareLinkByToken(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, statusError{http.StatusNotFound, "Link not found", "NOT_FOUND"}
	}
	if err != nil {
		return nil, err
	}
	if link.IsRevoked {
		return nil, statusError{http.StatusForbidden, "This link has been revoked", "REVOKED"}
	}
	now := h.d.Clock().Truncate(time.Millisecond)
	if now.After(link.ExpiresAt.Time) {
		return nil, statusError{http.StatusForbidden, "This link has expired", "EXPIRED"}
	}
	if err := h.d.Q.TouchShareLink(ctx, jsontime.Ptr(now), link.ID); err != nil {
		return nil, err
	}
	lang, err := h.d.Q.UserPreferredLanguage(ctx, link.UserID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if lang == "" {
		lang = "en"
	}

	var prep any
	if link.AppointmentPrepID != nil && *link.AppointmentPrepID != "" {
		p, err := h.d.Q.SharePrep(ctx, *link.AppointmentPrepID, link.UserID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return nil, err
		default:
			prep = httpx.O("appointmentDate", p.AppointmentDate.YMD(), "visitLabel", p.VisitLabel,
				"clinicianName", p.ClinicianName, "visitReason", p.VisitReason,
				"topConcerns", nonNullRaw(p.TopConcerns), "doctorQuestions", nonNullRaw(p.DoctorQuestions),
				"personalNotes", p.PersonalNotes, "generatedSnapshot", rawOrNull(p.GeneratedSnapshot))
		}
	}

	eps, err := h.episodes(ctx, link.UserID, link.DateRangeStart, link.DateRangeEnd)
	if err != nil {
		return nil, err
	}
	summary := calculateSummary(eps, now)
	list := make([]any, len(eps))
	for i, e := range eps {
		list[i] = e.obj
	}

	last28, err := h.outcomes.Compute(ctx, link.UserID, "", "", 28)
	if err != nil {
		return nil, err
	}
	last90, err := h.outcomes.Compute(ctx, link.UserID, "", "", 90)
	if err != nil {
		return nil, err
	}
	monthly, err := h.outcomes.Monthly(ctx, link.UserID, 12)
	if err != nil {
		return nil, err
	}
	medSummary, err := h.medicationSummary(ctx, link.UserID, last90, now)
	if err != nil {
		return nil, err
	}
	questionnaires, err := h.questionnaires(ctx, link.UserID)
	if err != nil {
		return nil, err
	}

	display := "Patient"
	if link.PatientDisplayName != nil && *link.PatientDisplayName != "" {
		display = *link.PatientDisplayName
	}
	iso := func(t *jsontime.Time) any {
		if t == nil || t.IsZero() {
			return nil
		}
		return jsontime.Format(t.Time)
	}
	return httpx.O("patientDisplayName", display, "recipientName", link.RecipientName,
		"expiresAt", jsontime.Format(link.ExpiresAt.Time), "patientPreferredLanguage", lang,
		"appointmentPrep", prep,
		"dateRange", httpx.O("start", iso(link.DateRangeStart), "end", iso(link.DateRangeEnd)),
		"summary", summary, "episodes", list,
		"doctorGrade", httpx.O(
			"outcomes", httpx.O("last28", last28, "last90", last90, "monthly", monthly),
			"medicationSummary", medSummary,
			"questionnaires", questionnaires)), nil
}

func nonNullRaw(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return []any{}
	}
	return raw
}

func rawOrNull(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return raw
}

func (h handlers) medicationSummary(ctx context.Context, uid string, last90 *httpx.Object, now time.Time) ([]any, error) {
	zone, _ := last90.Get("timezone")
	name, _ := zone.(string)
	loc, ok := tz.Load(name)
	if !ok {
		return nil, localdate.ErrInvalidTimeValue
	}
	from := luxon.PlusDays(localdate.StartOfDay(now, loc), loc, -89)
	to := localdate.StartOfDay(luxon.PlusDays(now, loc, 1), loc)
	rows, err := h.d.Q.ShareMedicationNames(ctx, uid, jsontime.New(from), jsontime.New(to))
	if err != nil {
		return nil, err
	}
	type use struct {
		name string
		uses int
	}
	var order []*use
	byName := map[string]*use{}
	for _, m := range rows {
		n := jsx.Trim(firstName(m.MedicationName, m.CustomName, m.CanonicalName))
		if n == "" {
			continue
		}
		u, ok := byName[n]
		if !ok {
			u = &use{name: n}
			byName[n] = u
			order = append(order, u)
		}
		u.uses++
	}
	sort.SliceStable(order, func(i, j int) bool { return order[i].uses > order[j].uses })
	out := make([]any, len(order))
	for i, u := range order {
		out[i] = httpx.O("name", u.name, "uses", u.uses)
	}
	return out, nil
}

func (h handlers) questionnaires(ctx context.Context, uid string) (*httpx.Object, error) {
	rows, err := h.d.Q.ShareQuestionnaires(ctx, uid)
	if err != nil {
		return nil, err
	}
	by := map[string][]any{"HIT6": {}, "MIDAS": {}, "MSQ21": {}}
	for _, r := range rows {
		if _, ok := by[r.Type]; !ok {
			continue
		}
		var score any
		if r.ScoreTotal != nil {
			score = *r.ScoreTotal
		}
		var details any
		if len(r.ScoreDetails) > 0 && string(r.ScoreDetails) != "null" {
			details = r.ScoreDetails
		}
		by[r.Type] = append(by[r.Type], httpx.O("id", r.ID, "type", r.Type, "takenAt", jsontime.Format(r.TakenAt.Time),
			"scoreTotal", score, "scoreDetails", details))
	}
	return httpx.O("hit6", by["HIT6"], "midas", by["MIDAS"], "msq21", by["MSQ21"]), nil
}
