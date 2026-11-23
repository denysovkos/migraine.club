package mcp

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/service/acutemeds"
	"github.com/denysovkos/migraine.club/internal/service/appointmentprep"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/service/episodes"
	"github.com/denysovkos/migraine.club/internal/service/factors"
	"github.com/denysovkos/migraine.club/internal/service/insights"
	"github.com/denysovkos/migraine.club/internal/service/meds"
	"github.com/denysovkos/migraine.club/internal/service/reports"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	z "github.com/denysovkos/migraine.club/internal/zod"
)

// Services are what the tools call; they are the services the API routes
// use.
type Services struct {
	Episodes        *episodes.Service
	Diary           *diary.Service
	Meds            *meds.Service
	Factors         *factors.Service
	Insights        *insights.Service
	Reports         *reports.Service
	AppointmentPrep *appointmentprep.Service
	// InsightsEnabled is Env.ENABLE_F39_INSIGHTS.
	InsightsEnabled bool
}

var (
	ymd       = z.String().Regex(`^\d{4}-\d{2}-\d{2}$`, "Expected YYYY-MM-DD")
	isoTime   = func() z.Schema { return z.Optional(z.String().Datetime()) }
	hhmm      = z.Nullable(z.String().Regex(`^([01]\d|2[0-3]):[0-5]\d$`))
	intensity = z.Number().Int().Min(1).Max(5)
)

func enumArray(values []string) z.Schema { return z.Optional(z.Array(z.Enum(values...))) }

func attackDetailFields() []z.Field {
	return []z.Field{
		z.F("painLocation", z.Optional(z.Enum(episodes.PainLocations...))),
		z.F("painType", z.Optional(z.Enum(episodes.PainTypes...))),
		z.F("symptoms", enumArray(episodes.Symptoms)),
		z.F("triggers", enumArray(episodes.Triggers)),
		z.F("protectors", enumArray(episodes.Protectors)),
		z.F("notes", z.Optional(z.String().Max(2000))),
	}
}

func str(args map[string]any, k string) (string, bool) {
	s, ok := args[k].(string)
	return s, ok
}

func num(args map[string]any, k string, def float64) float64 {
	if f, ok := args[k].(float64); ok {
		return f
	}
	return def
}

func strPtr(args map[string]any, k string) *string {
	if s, ok := args[k].(string); ok {
		return &s
	}
	return nil
}

func iso(t time.Time) string { return jsontime.Format(t) }

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

func timePtr(args map[string]any, k string) *time.Time {
	s, ok := str(args, k)
	if !ok {
		return nil
	}
	t, err := jsontime.Parse(s)
	if err != nil {
		return nil
	}
	return &t
}

// buildTools registers the tools of src/server/mcp/tools in registry order.
func buildTools(svc Services, now func() time.Time) map[string]toolDef {
	defs := []toolDef{
		{name: "get_user_context", scope: ScopeRead, run: func(ctx context.Context, _ map[string]any, tc toolCtx) (toolResult, error) {
			tz, err := usertz.Get(ctx, svc.Episodes.Q, tc.UserID)
			if err != nil {
				return toolResult{}, err
			}
			ongoing, err := svc.Episodes.Ongoing(ctx, tc.UserID)
			if err != nil {
				return toolResult{}, err
			}
			ok, err := consent.HasHealthDataConsent(ctx, svc.Episodes.Q, tc.UserID)
			if err != nil {
				return toolResult{}, err
			}
			summary := fmt.Sprintf("Timezone %s. No attack is currently ongoing.", tz)
			var attack any
			if ongoing != nil {
				summary = fmt.Sprintf("Timezone %s. An attack is ongoing (id %d, %s), started %s.", tz, ongoing.ID, ongoing.AttackType, iso(ongoing.StartTime.Time))
				attack = httpx.O("attackId", ongoing.ID, "attackType", ongoing.AttackType, "startTime", iso(ongoing.StartTime.Time))
			}
			return toolResult{summary, httpx.O("timezone", tz, "serverTimeUtc", iso(now()), "healthDataConsent", ok, "ongoingAttack", attack)}, nil
		}},

		{name: "list_attacks", scope: ScopeRead, input: z.Object(
			z.F("from", isoTime()), z.F("to", isoTime()),
			z.F("limit", z.Optional(z.Number().Int().Min(1).Max(200))),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			limit := math.Min(num(args, "limit", 50), 200)
			res, err := svc.Episodes.List(ctx, tc.UserID, 1, limit, timePtr(args, "from"), timePtr(args, "to"))
			if err != nil {
				return toolResult{}, err
			}
			list := make([]any, len(res.Episodes))
			for i, ep := range res.Episodes {
				list[i] = episodes.DTO(ep)
			}
			return toolResult{fmt.Sprintf("%d attack(s) returned of %d in range.", len(list), res.Total),
				httpx.O("returned", len(list), "total", res.Total, "truncated", res.Total > len(list), "attacks", list)}, nil
		}},

		{name: "log_attack", scope: ScopeWrite, input: z.Object(append([]z.Field{
			z.F("intensity", intensity),
			z.F("attackType", z.Optional(z.Enum("migraine", "headache"))),
			z.F("startTime", isoTime()), z.F("onsetAt", isoTime()),
			z.F("isOngoing", z.Optional(z.Boolean())),
		}, attackDetailFields()...)...), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			hasDetail := false
			for _, k := range []string{"painLocation", "painType", "symptoms", "triggers", "protectors", "notes"} {
				if _, ok := args[k]; ok {
					hasDetail = true
				}
			}
			body := map[string]any{"intensity": args["intensity"]}
			for _, k := range []string{"attackType", "startTime", "onsetAt"} {
				if v, ok := args[k]; ok {
					body[k] = v
				}
			}
			body["isOngoing"] = true
			if v, ok := args["isOngoing"]; ok {
				body["isOngoing"] = v
			}
			if hasDetail {
				or := func(k string, def any) {
					if v, ok := args[k]; ok {
						body[k] = v
					} else {
						body[k] = def
					}
				}
				or("painLocation", "OTHER")
				or("painType", "OTHER")
				or("symptoms", []any{})
				or("triggers", []any{})
				or("protectors", []any{})
				if v, ok := args["notes"]; ok {
					body["notes"] = v
				}
			} else {
				body["mode"] = "quick"
			}
			ep, err := svc.Episodes.Create(ctx, tc.UserID, body)
			if err != nil {
				return toolResult{}, err
			}
			return toolResult{fmt.Sprintf("Logged %s at intensity %d/5 (attack id %d).", ep.AttackType, ep.Intensity, ep.ID), ep}, nil
		}},

		{name: "update_attack", scope: ScopeWrite, input: z.Object(append([]z.Field{
			z.F("attackId", z.Number().Int().Positive()),
			z.F("endNow", z.Optional(z.Boolean())),
			z.F("endTime", isoTime()), z.F("startTime", isoTime()), z.F("onsetAt", isoTime()),
			z.F("isOngoing", z.Optional(z.Boolean())),
			z.F("intensity", z.Optional(intensity)),
			z.F("attackType", z.Optional(z.Enum("migraine", "headache"))),
		}, attackDetailFields()...)...), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			id := args["attackId"].(float64)
			patch := map[string]any{}
			for k, v := range args {
				if k != "attackId" {
					patch[k] = v
				}
			}
			if id > math.MaxInt32 {
				// Postgres refused the integer, which surfaced as an internal error.
				return toolResult{}, errors.New(`value "` + jsx.FormatNumber(id) + `" is out of range for type integer`)
			}
			ep, err := svc.Episodes.Update(ctx, tc.UserID, int32(id), patch)
			if err != nil {
				return toolResult{}, err
			}
			summary := fmt.Sprintf("Attack %s updated; still ongoing.", jsx.FormatNumber(id))
			if !ep.IsOngoing {
				end := "unknown"
				if ep.EndTime != nil {
					end = iso(ep.EndTime.Time)
				}
				summary = fmt.Sprintf("Attack %s updated; ended %s.", jsx.FormatNumber(id), end)
			}
			return toolResult{summary, episodes.DTO(ep)}, nil
		}},

		{name: "list_medication_doses", scope: ScopeRead, input: z.Object(
			z.F("from", isoTime()), z.F("to", isoTime()),
			z.F("limit", z.Optional(z.Number().Int().Min(1).Max(200))),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			limit := math.Min(num(args, "limit", 100), 200)
			var from, to *jsontime.Time
			if t := timePtr(args, "from"); t != nil {
				from = jsontime.Ptr(*t)
			}
			if t := timePtr(args, "to"); t != nil {
				to = jsontime.Ptr(*t)
			}
			rows, err := svc.Meds.Q.ListAcuteDoses(ctx, tc.UserID, from, to, int32(limit))
			if err != nil {
				return toolResult{}, err
			}
			doses := make([]any, len(rows))
			for i, d := range rows {
				doses[i] = d
			}
			return toolResult{fmt.Sprintf("%d acute dose(s) in range.", len(rows)),
				httpx.O("returned", len(rows), "truncated", float64(len(rows)) == limit, "doses", doses)}, nil
		}},

		{name: "log_medication_dose", scope: ScopeWrite, input: z.Object(
			z.F("medicationName", z.Optional(z.String().Trim().Min(1).Max(200))),
			z.F("userMedicationId", z.Optional(z.String().GUID())),
			z.F("dose", z.Optional(z.String().Trim().Min(1).Max(100))),
			z.F("unit", z.Optional(z.String().Trim().Min(1).Max(50))),
			z.F("takenAt", isoTime()),
			z.F("attackId", z.Optional(z.Number().Int().Positive())),
			z.F("notes", z.Optional(z.String().Max(1000))),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			name, _ := str(args, "medicationName")
			medID, _ := str(args, "userMedicationId")
			if name == "" && medID == "" {
				return toolResult{}, &z.Error{Issues: []z.Issue{z.CustomIssue([]any{"medicationName"}, "Either medicationName or userMedicationId is required.")}}
			}
			if medID == "" {
				id, err := svc.Meds.EnsureCustomMed(ctx, tc.UserID, name)
				if err != nil {
					return toolResult{}, err
				}
				medID = id
			}
			med, err := svc.Meds.Q.OwnedUserMed(ctx, tc.UserID, medID)
			if err != nil {
				if isNoRows(err) {
					return toolResult{}, &codedError{"MEDICATION_NOT_FOUND", "Medication not found"}
				}
				return toolResult{}, err
			}
			var attack *int64
			if f, ok := args["attackId"].(float64); ok {
				v := int64(f)
				attack = &v
			}
			if med.IsAcute {
				doseID, attackID, err := svc.Meds.CreateDose(ctx, tc.UserID, meds.DoseInput{MedicationID: med.ID, AttackID: attack,
					TakenAt: strPtr(args, "takenAt"), Dose: strPtr(args, "dose"), Unit: strPtr(args, "unit"), Notes: strPtr(args, "notes")})
				if err != nil {
					return toolResult{}, err
				}
				summary := "Logged as an acute dose."
				if attackID != nil && *attackID != 0 {
					summary = fmt.Sprintf("Logged as an acute dose, linked to attack %d.", *attackID)
				}
				return toolResult{summary, httpx.O("doseId", doseID, "attackId", attackID, "kind", "acute", "userMedicationId", med.ID)}, nil
			}
			res, err := svc.Meds.CreateIntake(ctx, tc.UserID, meds.IntakeInput{UserMedicationID: &med.ID,
				Dose: strPtr(args, "dose"), Unit: strPtr(args, "unit"), EpisodeID: attack})
			if err != nil {
				return toolResult{}, err
			}
			summary := "Logged as a preventive/other intake."
			if res.LinkedEpisodeID != nil && *res.LinkedEpisodeID != 0 {
				summary = fmt.Sprintf("Logged as a preventive/other intake, linked to attack %d.", *res.LinkedEpisodeID)
			}
			return toolResult{summary, httpx.O("intakeId", res.IntakeID, "linkedEpisodeId", res.LinkedEpisodeID,
				"userMedicationId", res.UserMedicationID, "kind", "intake")}, nil
		}},

		{name: "get_diary", scope: ScopeRead, input: z.Object(z.F("from", ymd), z.F("to", ymd)),
			run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
				from, _ := str(args, "from")
				to, _ := str(args, "to")
				res, err := svc.Diary.Range(ctx, tc.UserID, from, to)
				if err != nil {
					return toolResult{}, err
				}
				return toolResult{fmt.Sprintf("Diary from %s to %s.", from, to), res}, nil
			}},

		{name: "update_diary_day", scope: ScopeWrite, input: z.Object(
			z.F("localDate", ymd),
			z.F("dayType", z.Optional(z.Enum("headache_free", "headache_day", "migraine_day"))),
			z.F("impact", z.Optional(z.Nullable(z.Number().Int().Min(0).Max(4)))),
			z.F("notes", z.Optional(z.Nullable(z.String().Max(2000)))),
			z.F("bedTimeLocal", z.Optional(hhmm)),
			z.F("wakeTimeLocal", z.Optional(hhmm)),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			day, _ := str(args, "localDate")
			patch := map[string]any{}
			for k, v := range args {
				if k != "localDate" {
					patch[k] = v
				}
			}
			saved, err := svc.Diary.Upsert(ctx, tc.UserID, day, diary.PatchFrom(patch))
			if err != nil {
				return toolResult{}, err
			}
			return toolResult{fmt.Sprintf("Diary entry for %s saved.", day), saved}, nil
		}},

		{name: "log_factor", scope: ScopeWrite, input: z.Object(
			z.F("displayName", z.String().Trim().Min(1).Max(80)),
			z.F("type", z.Enum("trigger", "protector", "symptom")),
			z.F("occurredAt", isoTime()),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			name, _ := str(args, "displayName")
			kind, _ := str(args, "type")
			factorID, eventID, at, err := svc.Factors.Log(ctx, tc.UserID, factors.LogInput{DisplayName: name, Type: kind, OccurredAt: strPtr(args, "occurredAt")})
			if err != nil {
				return toolResult{}, err
			}
			return toolResult{"Logged " + kind + ` "` + name + `".`,
				httpx.O("factorId", factorID, "eventId", eventID, "occurredAt", iso(at))}, nil
		}},

		{name: "get_insights", scope: ScopeRead, input: z.Object(
			z.F("windowDays", z.Optional(z.Union(z.Literal(30), z.Literal(60), z.Literal(90), z.Literal(180)))),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			if !svc.InsightsEnabled {
				return toolResult{"Insights are not enabled for this deployment.", httpx.O("state", "disabled")}, nil
			}
			ok, err := consent.HasHealthDataConsent(ctx, svc.Episodes.Q, tc.UserID)
			if err != nil {
				return toolResult{}, err
			}
			if !ok {
				return toolResult{"Health data consent is required before insights can be computed.", httpx.O("state", "consent_required")}, nil
			}
			window := int(num(args, "windowDays", 90))
			at := now()
			cached, err := svc.Insights.Latest(ctx, tc.UserID, window)
			if err != nil {
				return toolResult{}, err
			}
			stale := cached == nil || cached.Stale || at.Sub(cached.ComputedAt.Time) > 24*time.Hour
			summary := fmt.Sprintf("Insights over the last %d days.", window)
			if stale {
				res, err := svc.Insights.ComputeAndStore(ctx, tc.UserID, window, at)
				if err == nil {
					return toolResult{summary, httpx.O("state", "ready", "windowDays", window, "methodVersion", insights.MethodVersion,
						"payload", res.Payload, "status", res.Status)}, nil
				}
				svc.Insights.Log.Error("MCP insights recompute failed", "error", err, "userId", tc.UserID, "windowDays", window)
				if cached == nil {
					return toolResult{}, err
				}
			}
			status := "ready"
			if stale {
				status = "stale"
			}
			return toolResult{summary, httpx.O("state", "ready", "windowDays", window, "methodVersion", insights.MethodVersion,
				"payload", cached.PayloadJson, "computedAt", iso(cached.ComputedAt.Time), "status", status)}, nil
		}},

		{name: "get_moh_status", scope: ScopeRead, input: z.Object(
			z.F("windowDays", z.Optional(z.Number().Int().Min(1).Max(60))),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			res, err := acutemeds.MohStatus(ctx, svc.Episodes.Q, tc.UserID, now(), int(num(args, "windowDays", 30)))
			if err != nil {
				return toolResult{}, err
			}
			status, _ := res.Get("status")
			return toolResult{fmt.Sprintf("Medication-overuse status: %v.", status), res}, nil
		}},

		{name: "get_clinician_report", scope: ScopeRead, input: z.Object(
			z.F("from", z.Optional(ymd)), z.F("to", z.Optional(ymd)),
			z.F("rangePreset", z.Optional(z.Enum("last30", "last90", "last180"))),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			from, _ := str(args, "from")
			to, _ := str(args, "to")
			raw := map[string]any{"template": "full"}
			if from != "" && to != "" {
				raw["rangePreset"], raw["from"], raw["to"] = "custom", from, to
			} else {
				preset, ok := str(args, "rangePreset")
				if !ok {
					preset = "last90"
				}
				raw["rangePreset"] = preset
			}
			cfg, err := reports.ParseConfig(raw)
			if err != nil {
				return toolResult{}, err
			}
			model, err := svc.Reports.Build(ctx, tc.UserID, cfg)
			if err != nil {
				return toolResult{}, err
			}
			text := htmlToText(reports.RenderHTML(model))
			return toolResult{fmt.Sprintf("Clinician report generated (%d characters).", utf16Len(text)), httpx.O("report", text)}, nil
		}},

		{name: "list_appointment_preps", scope: ScopeRead, input: z.Object(
			z.F("limit", z.Optional(z.Number().Int().Min(1).Max(50))),
		), run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
			drafts, err := svc.AppointmentPrep.List(ctx, tc.UserID)
			if err != nil {
				return toolResult{}, err
			}
			n := min(int(num(args, "limit", 20)), len(drafts))
			limited := drafts[:n]
			return toolResult{fmt.Sprintf("%d appointment prep draft(s).", n),
				httpx.O("returned", n, "truncated", len(drafts) > n, "drafts", limited)}, nil
		}},

		{name: "get_appointment_prep", scope: ScopeRead, input: z.Object(z.F("id", z.String().GUID())),
			run: func(ctx context.Context, args map[string]any, tc toolCtx) (toolResult, error) {
				id, _ := str(args, "id")
				d, err := svc.AppointmentPrep.Get(ctx, tc.UserID, id)
				if err != nil {
					return toolResult{}, err
				}
				if d == nil {
					return toolResult{"No appointment prep draft with that id.", httpx.O("code", "NOT_FOUND")}, nil
				}
				return toolResult{"Appointment prep draft.", appointmentprep.Draft(*d, true)}, nil
			}},
	}
	out := map[string]toolDef{}
	for _, d := range defs {
		out[d.name] = d
	}
	return out
}

// jsWhitespace is JavaScript's \s.
var jsWhitespace = "\t\n\v\f\r " + string([]rune{0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff})

// hasPrefixFold is a case-insensitive ASCII prefix test (JavaScript /i only
// folds ASCII letters onto ASCII letters).
func hasPrefixFold(s, prefix string) bool {
	if len(s) < len(prefix) {
		return false
	}
	for i := 0; i < len(prefix); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		if c != prefix[i] {
			return false
		}
	}
	return true
}

func indexFold(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if hasPrefixFold(s[i:], sub) {
			return i
		}
	}
	return -1
}

// stripScriptStyle is .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').
func stripScriptStyle(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		matched := false
		if s[i] == '<' {
			for _, tag := range []string{"script", "style"} {
				if !hasPrefixFold(s[i+1:], tag) {
					continue
				}
				gt := strings.IndexByte(s[i+1+len(tag):], '>')
				if gt < 0 {
					continue
				}
				bodyStart := i + 1 + len(tag) + gt + 1
				end := indexFold(s[bodyStart:], "</"+tag+">")
				if end < 0 {
					continue
				}
				i = bodyStart + end + len(tag) + 3
				matched = true
				break
			}
		}
		if !matched {
			b.WriteByte(s[i])
			i++
		}
	}
	return b.String()
}

var (
	closeBlockRe = regexp.MustCompile(`(?i)</(p|div|tr|h[1-6]|li)>`)
	brRe         = regexp.MustCompile(`(?i)<br[` + jsWhitespace + `]*/?>`)
	tagRe        = regexp.MustCompile(`<[^>]+>`)
	spacesRe     = regexp.MustCompile(`[ \t]+`)
	newlinesRe   = regexp.MustCompile(`\n{3,}`)
)

// htmlToText is analysis.ts htmlToText.
func htmlToText(html string) string {
	s := stripScriptStyle(html)
	s = closeBlockRe.ReplaceAllString(s, "\n")
	s = brRe.ReplaceAllString(s, "\n")
	s = tagRe.ReplaceAllString(s, " ")
	s = strings.NewReplacer("&nbsp;", " ").Replace(s)
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = spacesRe.ReplaceAllString(s, " ")
	s = newlinesRe.ReplaceAllString(s, "\n\n")
	return jsx.Trim(s)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
