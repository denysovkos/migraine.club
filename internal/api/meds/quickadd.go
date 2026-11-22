// Package meds serves the medication logging routes: quick-add, acute doses
// and dose outcomes.
package meds

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/api/idem"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/meds"
	"github.com/denysovkos/migraine.club/internal/zod"
)

type handlers struct {
	d   *app.Deps
	svc *meds.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &meds.Service{Q: d.Q, Log: d.Log, Now: d.Clock}}
	r.Get("/api/quick-add/suggestions", h.suggestions)
	r.Post("/api/quick-add/medication-intake", h.createIntake)
	r.Delete("/api/quick-add/medication-intake/{id}", h.deleteIntake)
	r.Patch("/api/quick-add/medication-intake/{id}", h.patchIntake)
	r.Post("/api/acute-doses", h.createDose)
	r.Post("/api/dose-outcomes", h.doseOutcome)
	mountCatalog(r, d)
}

var consentRequired = httpx.O(
	"error", "Health data consent required", "code", "CONSENT_REQUIRED",
	"message", "You must provide explicit consent for health data processing before logging.")

// gate checks auth and consent the way the quick-add routes did: before any
// try/catch, so a failing consent query is an unhandled 500.
func (h handlers) gate(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return "", false
	}
	ok, err := consent.HasHealthDataConsent(r.Context(), h.d.Q, uid)
	if err != nil {
		httpx.Unhandled(w)
		return "", false
	}
	if !ok {
		httpx.JSON(w, http.StatusForbidden, consentRequired)
		return "", false
	}
	return uid, true
}

func (h handlers) suggestions(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	res, err := h.svc.Suggestions(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) createIntake(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, uid, "quick-add/medication-intake", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := h.gate(w, r); !ok {
			return
		}
		fail := func(err error) {
			var zerr *zod.Error
			if errors.As(err, &zerr) {
				httpx.ValidationError(w, zerr)
				return
			}
			h.d.Log.Error("Error creating medication intake (quick-add)", "userId", uid, "error", err)
			httpx.Error(w, http.StatusInternalServerError, err.Error())
		}
		body, err := httpx.ReadJSON(r)
		if err != nil {
			fail(err)
			return
		}
		var in meds.IntakeInput
		if err := zod.ParseInto(meds.IntakeSchema, body, &in); err != nil {
			fail(err)
			return
		}
		var takenAt string
		if in.TakenAt != nil {
			takenAt = *in.TakenAt
		}
		captured, msg := idem.ResolveCapturedAt(takenAt, h.d.Clock(), 7, 0)
		if msg != "" {
			httpx.JSON(w, http.StatusBadRequest, httpx.O("error", msg, "code", "INVALID_TAKEN_AT"))
			return
		}
		iso := jsontime.Format(captured)
		in.TakenAt = &iso
		created, err := h.svc.CreateIntake(r.Context(), uid, in)
		if err != nil {
			fail(err)
			return
		}
		var acuteDoseID *string
		if in.RecordAcuteDose != nil && *in.RecordAcuteDose {
			id, _, err := h.svc.CreateDose(r.Context(), uid, meds.DoseInput{
				MedicationID: created.UserMedicationID, AttackID: created.LinkedEpisodeID,
				TakenAt: &iso, Dose: in.Dose, Unit: in.Unit, UnitIsCustom: in.UnitIsCustom,
			})
			if err != nil {
				h.d.Log.Warn("Failed to record acute dose alongside intake", "userId", uid, "error", err)
			} else {
				acuteDoseID = &id
			}
		}
		h.d.Log.Info("Medication intake created (quick-add)", "userId", uid, "intakeId", created.IntakeID)
		o := httpx.O("intakeId", created.IntakeID)
		if created.LinkedEpisodeID != nil {
			o.Set("linkedEpisodeId", *created.LinkedEpisodeID)
		}
		o.Set("userMedicationId", created.UserMedicationID)
		if acuteDoseID != nil {
			o.Set("acuteDoseId", *acuteDoseID)
		}
		httpx.JSON(w, http.StatusCreated, o)
	})
}

func (h handlers) deleteIntake(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	found, err := h.svc.DeleteIntake(r.Context(), uid, id)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if !found {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	h.d.Log.Info("Medication intake deleted (undo)", "userId", uid, "intakeId", id)
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}

func (h handlers) patchIntake(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	body, err := httpx.ReadJSON(r)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	parsed, err := zod.Parse(meds.UpdateIntakeSchema, body)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	m := parsed.(map[string]any)
	var p meds.IntakePatch
	if v, ok := m["dose"]; ok {
		p.SetDose = true
		if s, ok := v.(string); ok {
			p.Dose = &s
		}
	}
	if v, ok := m["unit"]; ok {
		p.SetUnit = true
		if s, ok := v.(string); ok {
			p.Unit = &s
		}
	}
	if v, ok := m["unitIsCustom"].(bool); ok {
		p.UnitIsCustom = &v
	}
	// takenAt: null and "" leave the time alone (undefined in the Node code).
	if s, ok := m["takenAt"].(string); ok && s != "" {
		if t, err := jsontime.Parse(s); err == nil {
			p.TakenAt = &t
		}
	}
	found, err := h.svc.UpdateIntake(r.Context(), uid, id, p)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if !found {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	h.d.Log.Info("Medication intake updated", "userId", uid, "intakeId", id)
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}

func (h handlers) createDose(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, uid, "acute-doses", func(w http.ResponseWriter, r *http.Request) {
		fail := func(err error) {
			var zerr *zod.Error
			var derr *meds.DoseError
			switch {
			case errors.As(err, &zerr):
				httpx.ValidationError(w, zerr)
				return
			case errors.As(err, &derr) && derr.Code == "CONSENT_REQUIRED":
				httpx.JSON(w, http.StatusForbidden, httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED"))
				return
			case errors.As(err, &derr) && derr.Code == "MEDICATION_NOT_FOUND":
				httpx.Error(w, http.StatusNotFound, "Medication not found")
				return
			}
			h.d.Log.Error("Failed to log acute dose", "userId", uid, "error", err)
			httpx.Error(w, http.StatusInternalServerError, err.Error())
		}
		body, err := httpx.ReadJSON(r)
		if err != nil {
			fail(err)
			return
		}
		var in meds.DoseInput
		if err := zod.ParseInto(meds.DoseSchema, body, &in); err != nil {
			fail(err)
			return
		}
		id, attack, err := h.svc.CreateDose(r.Context(), uid, in)
		if err != nil {
			fail(err)
			return
		}
		httpx.JSON(w, http.StatusCreated, httpx.O("doseId", id, "attackId", attack))
	})
}

var doseOutcomeSchema = zod.Object(
	zod.F("doseId", zod.String().GUID()),
	zod.F("helped", zod.Enum("yes", "partly", "no")),
	zod.F("backToNormalFunction", zod.Optional(zod.Nullable(zod.Boolean()))),
	zod.F("timeToReliefMinutes", zod.Optional(zod.Nullable(zod.Number().Int().Min(0).Max(24*60)))),
	zod.F("notes", zod.Optional(zod.Nullable(zod.String().Max(1000)))),
)

func (h handlers) doseOutcome(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	ok, err := consent.HasHealthDataConsent(r.Context(), h.d.Q, uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if !ok {
		httpx.JSON(w, http.StatusForbidden, httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED"))
		return
	}
	fail := func(err error) {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			httpx.ValidationError(w, zerr)
			return
		}
		h.d.Log.Error("Failed to upsert dose outcome", "userId", uid, "error", err)
		httpx.Error(w, http.StatusInternalServerError, err.Error())
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(err)
		return
	}
	var in struct {
		DoseID               string  `json:"doseId"`
		Helped               string  `json:"helped"`
		BackToNormalFunction *bool   `json:"backToNormalFunction"`
		TimeToReliefMinutes  *int32  `json:"timeToReliefMinutes"`
		Notes                *string `json:"notes"`
	}
	if err := zod.ParseInto(doseOutcomeSchema, body, &in); err != nil {
		fail(err)
		return
	}
	if _, err := h.d.Q.OwnedAcuteDoseID(r.Context(), uid, in.DoseID); err != nil {
		if isNoRows(err) {
			httpx.Error(w, http.StatusNotFound, "Dose not found")
			return
		}
		fail(err)
		return
	}
	id, err := h.d.Q.UpsertDoseOutcome(r.Context(), qUpsertDoseOutcome(uid, in.DoseID, in.Helped, in.BackToNormalFunction, in.TimeToReliefMinutes, meds.SanitizeNotes(in.Notes), h.d.Clock()))
	if err != nil {
		fail(err)
		return
	}
	h.d.Log.Info("Dose outcome upserted", "userId", uid, "doseId", in.DoseID)
	httpx.JSON(w, http.StatusOK, httpx.O("outcomeId", id, "doseId", in.DoseID))
}
