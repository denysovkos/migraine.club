// Package intake is src/services/intake: the onboarding questionnaire and
// the domain rows it seeds on completion.
package intake

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/preventives"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// Version is INTAKE_VERSION.
const Version = 1

// StepOrder is INTAKE_STEP_ORDER.
var StepOrder = []string{"frequency", "triggers", "medications", "habits"}

// pinLimit is how many acute meds get pinned to Quick Kit.
const pinLimit = 3

const hhmm = `^([01]\d|2[0-3]):[0-5]\d$`

// Schemas from src/models/intake.ts.
var (
	frequencyBlock = zod.Object(zod.F("band", zod.Enum("lt1", "1_3", "4_7", "8_14", "15_plus")))
	triggersBlock  = zod.Object(
		zod.F("keys", zod.Array(zod.String().Trim().Min(1).Max(64)).Max(30)),
		zod.F("custom", zod.Array(zod.String().Trim().Min(1).Max(64)).Max(10)),
	)
	acuteMedEntry = zod.Refine(zod.Object(
		zod.F("catalogMedicationId", zod.Nullish(zod.String().GUID())),
		zod.F("customName", zod.Nullish(zod.String().Trim().Min(1).Max(200))),
		zod.F("defaultDose", zod.Nullish(zod.String().Trim().Max(40))),
		zod.F("defaultUnit", zod.Nullish(zod.String().Trim().Max(40))),
		zod.F("defaultUnitIsCustom", zod.Optional(zod.Boolean())),
		zod.F("medicationClass", zod.Optional(zod.Enum("triptan", "ergotamine", "combination_analgesic", "opioid", "non_opioid_simple_analgesic"))),
	), func(v any) bool {
		m := v.(map[string]any)
		return truthy(m["catalogMedicationId"]) || truthy(m["customName"])
	}, "catalogMedicationId or customName is required")
	preventiveEntry = zod.Object(
		zod.F("catalogMedicationId", zod.Nullish(zod.String().GUID())),
		zod.F("name", zod.String().Trim().Min(1).Max(200)),
		zod.F("kind", zod.Enum("oral", "injection", "infusion", "device", "supplement", "other")),
		zod.F("doseText", zod.Nullish(zod.String().Trim().Max(120))),
		zod.F("scheduleType", zod.Enum("daily", "weekdays", "every_n_days", "every_n_weeks", "custom_weekdays", "on_specific_dates")),
		zod.F("schedulePayload", zod.Optional(zod.Unknown())),
		zod.F("startDate", zod.Nullish(zod.String().Regex(`^\d{4}-\d{2}-\d{2}$`))),
	)
	medicationsBlock = zod.Object(
		zod.F("acute", zod.Array(acuteMedEntry).Max(20)),
		zod.F("preventive", zod.Array(preventiveEntry).Max(20)),
	)
	habitsBlock = zod.Object(
		zod.F("sleepTrouble", zod.Nullable(zod.Enum("often", "sometimes", "rarely"))),
		zod.F("typicalBed", zod.Nullable(zod.String().Regex(hhmm))),
		zod.F("typicalWake", zod.Nullable(zod.String().Regex(hhmm))),
		zod.F("medTiming", zod.Nullable(zod.Enum("lt30", "30_120", "gt120", "varies"))),
	)
	// AnswersSchema is IntakeAnswersSchema.
	AnswersSchema = zod.Object(
		zod.F("frequency", zod.Default(zod.Nullable(frequencyBlock), nil)),
		zod.F("triggers", zod.Default(zod.Nullable(triggersBlock), nil)),
		zod.F("medications", zod.Default(zod.Nullable(medicationsBlock), nil)),
		zod.F("habits", zod.Default(zod.Nullable(habitsBlock), nil)),
	)
	// PatchSchema is IntakeBlockPatchSchema.
	PatchSchema = zod.DiscriminatedUnion("block",
		zod.Object(zod.F("block", zod.Literal("frequency")), zod.F("value", zod.Nullable(frequencyBlock))),
		zod.Object(zod.F("block", zod.Literal("triggers")), zod.F("value", zod.Nullable(triggersBlock))),
		zod.Object(zod.F("block", zod.Literal("medications")), zod.F("value", zod.Nullable(medicationsBlock))),
		zod.Object(zod.F("block", zod.Literal("habits")), zod.F("value", zod.Nullable(habitsBlock))),
	)
)

// truthy is JavaScript's `!!v` for parsed JSON values.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case bool:
		return x
	case float64:
		return x != 0
	default:
		return true
	}
}

// answers is a parsed IntakeAnswers: the four blocks in schema order, each
// nil (null) or the block's parsed value.
type answers = zod.OrderedObject

func emptyAnswers() answers {
	out, _ := zod.Parse(AnswersSchema, map[string]any{})
	return zod.Ordered(AnswersSchema, out).(answers)
}

// parseAnswers is parseAnswers: answers for another version, or that no
// longer parse, read as empty.
func parseAnswers(version int32, raw json.RawMessage) answers {
	if version != Version {
		return emptyAnswers()
	}
	var v any = map[string]any{}
	if len(raw) > 0 && string(raw) != "null" {
		decoded, err := zod.Decode(raw)
		if err != nil {
			return emptyAnswers()
		}
		v = decoded
	}
	out, err := zod.Parse(AnswersSchema, v)
	if err != nil {
		return emptyAnswers()
	}
	return zod.Ordered(AnswersSchema, out).(answers)
}

// Service is intakeService.
type Service struct {
	Pool *pgxpool.Pool
	Q    *q.Queries
	Now  func() time.Time
}

// DTO is IntakeDTO.
type DTO struct {
	Status      string
	CurrentStep int32
	Version     int32
	Answers     answers
	CompletedAt *jsontime.Time
}

// JSON is the response body.
func (d DTO) JSON() *httpx.Object {
	var completed any
	if d.CompletedAt != nil {
		completed = jsontime.Format(d.CompletedAt.Time)
	}
	return httpx.O("status", d.Status, "currentStep", d.CurrentStep, "version", d.Version,
		"answers", d.Answers, "completedAt", completed)
}

func toDTO(r q.IntakeResponse) DTO {
	return DTO{Status: r.Status, CurrentStep: r.CurrentStep, Version: r.Version,
		Answers: parseAnswers(r.Version, r.Answers), CompletedAt: r.CompletedAt}
}

// Get is get.
func (s *Service) Get(ctx context.Context, uid string) (DTO, error) {
	r, err := s.Q.GetIntakeResponse(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return DTO{Status: "in_progress", Version: Version, Answers: emptyAnswers()}, nil
	}
	if err != nil {
		return DTO{}, err
	}
	return toDTO(r), nil
}

func marshal(v any) json.RawMessage {
	b, _ := httpx.Marshal(v)
	return b
}

// PatchBlock is patchBlock. patch is IntakeBlockPatchSchema's parsed value.
func (s *Service) PatchBlock(ctx context.Context, uid string, patch map[string]any) (DTO, error) {
	current, err := s.Get(ctx, uid)
	if err != nil {
		return DTO{}, err
	}
	block := patch["block"].(string)
	value := zod.Ordered(PatchSchema, patch).(zod.OrderedObject).Values["value"]
	next := zod.OrderedObject{Keys: current.Answers.Keys, Values: map[string]any{}}
	for k, v := range current.Answers.Values {
		next.Values[k] = v
	}
	next.Values[block] = value
	step := max(current.CurrentStep, int32(slices.Index(StepOrder, block)+1))
	if err := s.Q.UpsertIntakeBlock(ctx, q.UpsertIntakeBlockParams{
		UserID: uid, Version: Version, Status: current.Status, CurrentStep: step,
		Answers: marshal(next), Now: jsontime.New(s.Now()),
	}); err != nil {
		return DTO{}, err
	}
	current.Answers, current.CurrentStep = next, step
	return current, nil
}

// Skip is skip.
func (s *Service) Skip(ctx context.Context, uid string) (DTO, error) {
	current, err := s.Get(ctx, uid)
	if err != nil || current.Status == "completed" {
		return current, err
	}
	if err := s.Q.UpsertIntakeSkipped(ctx, q.UpsertIntakeSkippedParams{
		UserID: uid, Version: Version, CurrentStep: current.CurrentStep, Answers: marshal(current.Answers),
		Now: jsontime.New(s.Now()),
	}); err != nil {
		return DTO{}, err
	}
	current.Status = "skipped"
	return current, nil
}

// Complete is complete: seeds the answers once, under a row lock.
func (s *Service) Complete(ctx context.Context, uid string) (DTO, error) {
	fast, err := s.Get(ctx, uid)
	if err != nil || fast.Status == "completed" {
		return fast, err
	}
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return DTO{}, err
	}
	today := luxon.ISODate(s.Now().In(tz.LoadOrUTC(zone)))

	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		qtx := s.Q.WithTx(tx)
		locked, err := qtx.LockIntakeResponse(ctx, uid)
		hasRow := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if hasRow && locked.Status == "completed" {
			return nil
		}
		ans := emptyAnswers()
		if hasRow {
			ans = parseAnswers(locked.Version, locked.Answers)
		}
		seeded, err := s.seed(ctx, qtx, uid, ans, today)
		if err != nil {
			return err
		}
		now := jsontime.New(s.Now())
		return qtx.UpsertIntakeCompleted(ctx, q.UpsertIntakeCompletedParams{
			UserID: uid, Version: Version, CurrentStep: int32(len(StepOrder)), Answers: marshal(ans),
			Seeded: marshal(seeded), CompletedAt: &now, Now: now,
		})
	})
	if err != nil {
		return DTO{}, err
	}
	return s.Get(ctx, uid)
}

// classByCatalogTag is CLASS_BY_CATALOG_TAG.
var classByCatalogTag = map[string]string{
	"triptan": "triptan", "ergotamine": "ergotamine", "opioid": "opioid", "combination_analgesic": "combination_analgesic",
}

// normalizeName is the canonical writer's trim + collapse.
func normalizeName(s string) string { return jsx.CollapseSpace(jsx.Trim(s), " ") }

func normalizeNameKey(name *string) string {
	if name == nil || *name == "" {
		return ""
	}
	return strings.ToLower(normalizeName(*name))
}

func strField(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok {
		return &v
	}
	return nil
}

func fields(v any) map[string]any {
	if o, ok := v.(zod.OrderedObject); ok {
		return o.Values
	}
	m, _ := v.(map[string]any)
	return m
}

// seed is seedFromIntake.
func (s *Service) seed(ctx context.Context, qtx *q.Queries, uid string, ans answers, today string) (*httpx.Object, error) {
	medIDs, planIDs, factorIDs := []string{}, []string{}, []string{}
	at := jsontime.Format(s.Now())

	if meds := fields(ans.Values["medications"]); meds != nil {
		existing, err := qtx.UserMedicationOwnership(ctx, uid)
		if err != nil {
			return nil, err
		}
		ownedCatalog, ownedNames := map[string]bool{}, map[string]bool{}
		for _, r := range existing {
			if r.CatalogMedicationID != nil && *r.CatalogMedicationID != "" {
				ownedCatalog[*r.CatalogMedicationID] = true
			}
			if k := normalizeNameKey(r.CustomName); k != "" {
				ownedNames[k] = true
			}
		}
		acute, _ := meds["acute"].([]any)
		var needClass []string
		for _, e := range acute {
			m := fields(e)
			if id := strField(m, "catalogMedicationId"); id != nil && *id != "" && !truthy(m["medicationClass"]) && !slices.Contains(needClass, *id) {
				needClass = append(needClass, *id)
			}
		}
		tagsByID := map[string][]any{}
		if len(needClass) > 0 {
			rows, err := qtx.CatalogTagsByIDs(ctx, needClass)
			if err != nil {
				return nil, err
			}
			for _, r := range rows {
				var tags []any
				if len(r.Tags) > 0 && string(r.Tags) != "null" {
					if err := json.Unmarshal(r.Tags, &tags); err != nil {
						return nil, err
					}
				}
				tagsByID[r.ID] = tags
			}
		}
		deriveClass := func(catalogID string, explicit *string) string {
			if explicit != nil && *explicit != "" {
				return *explicit
			}
			for _, t := range tagsByID[catalogID] {
				if tag, ok := t.(string); ok && classByCatalogTag[tag] != "" {
					return classByCatalogTag[tag]
				}
			}
			return "non_opioid_simple_analgesic"
		}

		pinned := 0
		for _, e := range acute {
			m := fields(e)
			catalogID := ""
			if id := strField(m, "catalogMedicationId"); id != nil {
				catalogID = *id
			}
			custom := strField(m, "customName")
			if catalogID == "" && (custom == nil || *custom == "") {
				continue
			}
			nameKey := normalizeNameKey(custom)
			if catalogID != "" && ownedCatalog[catalogID] {
				continue
			}
			if catalogID == "" && nameKey != "" && ownedNames[nameKey] {
				continue
			}
			params := q.InsertSeededUserMedicationParams{
				UserID: uid, DefaultDose: strField(m, "defaultDose"), DefaultUnit: strField(m, "defaultUnit"),
				MedicationClass: deriveClass(catalogID, strField(m, "medicationClass")), IsPinned: pinned < pinLimit,
			}
			if catalogID != "" {
				params.CatalogMedicationID = &catalogID
			}
			if custom != nil && *custom != "" {
				n := normalizeName(*custom)
				params.CustomName = &n
			}
			if b, ok := m["defaultUnitIsCustom"].(bool); ok {
				params.DefaultUnitIsCustom = b
			}
			id, err := qtx.InsertSeededUserMedication(ctx, params)
			if err != nil {
				return nil, err
			}
			medIDs = append(medIDs, id)
			if catalogID != "" {
				ownedCatalog[catalogID] = true
			}
			if nameKey != "" {
				ownedNames[nameKey] = true
			}
			pinned++
		}

		plans := &preventives.Service{Q: qtx, Now: s.Now}
		prev, _ := meds["preventive"].([]any)
		for _, e := range prev {
			m := fields(e)
			start := today
			if d := strField(m, "startDate"); d != nil {
				start = *d
			}
			id, err := plans.Create(ctx, uid, preventives.CreateInput{
				CatalogMedicationID: strField(m, "catalogMedicationId"), Name: *strField(m, "name"),
				Kind: *strField(m, "kind"), DoseText: strField(m, "doseText"), ScheduleType: *strField(m, "scheduleType"),
				SchedulePayload: m["schedulePayload"], StartDate: start, ReminderTimes: []string{},
			})
			if err != nil {
				return nil, err
			}
			planIDs = append(planIDs, id)
		}
	}

	if trig := fields(ans.Values["triggers"]); trig != nil {
		custom, _ := trig["custom"].([]any)
		for _, c := range custom {
			label := jsx.Trim(c.(string))
			key := "intake.trigger:" + jsx.CollapseSpace(strings.ToLower(label), "_")
			ids, err := qtx.InsertIntakeTriggerFactor(ctx, &uid, &key, label)
			if err != nil {
				return nil, err
			}
			factorIDs = append(factorIDs, ids...)
		}
	}
	return httpx.O("userMedicationIds", medIDs, "preventivePlanIds", planIDs, "factorIds", factorIDs, "at", at), nil
}
