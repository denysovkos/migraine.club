// Package push serves /api/push/subscribe, /unsubscribe and /test.
package push

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/i18n"
	"github.com/denysovkos/migraine.club/internal/service/profile"
	svc "github.com/denysovkos/migraine.club/internal/service/push"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var (
	subscribeSchema = zod.Object(
		zod.F("endpoint", zod.String().URL("Invalid endpoint URL")),
		zod.F("keys", zod.Object(
			zod.F("p256dh", zod.String().Min(1, "p256dh key is required")),
			zod.F("auth", zod.String().Min(1, "auth key is required")),
		)),
		zod.F("expirationTime", zod.Optional(zod.Nullable(zod.Number()))),
	)
	unsubscribeSchema = zod.Object(zod.F("endpoint", zod.String().URL("Invalid endpoint URL")))
)

type handlers struct {
	d       *app.Deps
	svc     *svc.Service
	profile *profile.Service
}

// NewService builds the push service from the deps; jobs share it.
func NewService(d *app.Deps) *svc.Service {
	return &svc.Service{Q: d.Q, Log: d.Log, HTTP: d.HTTP, PublicKey: d.Cfg.VAPIDPublicKey,
		PrivateKey: d.Cfg.VAPIDPrivateKey, Subject: d.Cfg.VAPIDSubject, Now: d.Clock}
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: NewService(d), profile: &profile.Service{Q: d.Q, Log: d.Log, Now: d.Clock}}
	r.Post("/api/push/subscribe", h.subscribe)
	r.Post("/api/push/unsubscribe", h.unsubscribe)
	r.Post("/api/push/test", h.test)
}

func (h handlers) fail(w http.ResponseWriter, msg, public string, err error) {
	h.d.Log.Error(msg, "error", err)
	httpx.Error(w, http.StatusInternalServerError, public)
}

func (h handlers) body(w http.ResponseWriter, r *http.Request, s zod.Schema, invalid, msg, public string) (map[string]any, bool) {
	body, err := httpx.ReadJSON(r)
	if err != nil {
		h.fail(w, msg, public, err)
		return nil, false
	}
	v, err := zod.Parse(s, body)
	if err != nil {
		var zerr *zod.Error
		if !errors.As(err, &zerr) {
			h.fail(w, msg, public, err)
			return nil, false
		}
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", invalid, "details", zerr.Flatten().FieldErrors))
		return nil, false
	}
	return v.(map[string]any), true
}

func (h handlers) subscribe(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	const msg, public = "Error subscribing to push notifications", "Failed to subscribe to push notifications"
	m, ok := h.body(w, r, subscribeSchema, "Invalid subscription data", msg, public)
	if !ok {
		return
	}
	keys := m["keys"].(map[string]any)
	sub := svc.Subscription{Endpoint: m["endpoint"].(string), P256dh: keys["p256dh"].(string), Auth: keys["auth"].(string)}
	if v, ok := m["expirationTime"].(float64); ok {
		sub.ExpirationTime = &v
	}
	var ua *string
	if v, ok := r.Header["User-Agent"]; ok {
		ua = &v[0]
	}
	id, err := h.svc.Subscribe(r.Context(), uid, sub, ua)
	if err != nil {
		h.fail(w, msg, public, err)
		return
	}
	h.d.Log.Info("User subscribed to push notifications", "userId", uid, "subscriptionId", id)
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true, "subscriptionId", id))
}

func (h handlers) unsubscribe(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	const msg, public = "Error unsubscribing from push notifications", "Failed to unsubscribe from push notifications"
	m, ok := h.body(w, r, unsubscribeSchema, "Invalid request data", msg, public)
	if !ok {
		return
	}
	n, err := h.svc.Unsubscribe(r.Context(), uid, m["endpoint"].(string))
	if err != nil {
		h.fail(w, msg, public, err)
		return
	}
	h.d.Log.Info("User unsubscribed from push notifications", "userId", uid, "deletedCount", n)
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true, "deletedCount", n))
}

func strp(s string) *string { return &s }

func boolp(b bool) *bool { return &b }

func (h handlers) test(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	const msg, public = "Error sending test notification", "Failed to send test notification"
	ok, err := h.svc.Configured()
	if err != nil {
		h.fail(w, msg, public, err)
		return
	}
	if !ok {
		h.d.Log.Warn("Push notifications not configured", "userId", uid)
		httpx.Error(w, http.StatusServiceUnavailable, "Push notifications are not configured on this server")
		return
	}
	p, found, err := h.profile.Get(r.Context(), uid)
	if err != nil {
		h.fail(w, msg, public, err)
		return
	}
	lang := ""
	if found {
		lang = p.PreferredLanguage
	}
	t, err := i18n.New(lang, "Push")
	if err != nil {
		h.fail(w, msg, public, err)
		return
	}
	res, err := h.svc.SendToUser(r.Context(), uid, svc.Payload{Title: t("test.title"), Body: t("test.body"),
		Icon: strp("/android-chrome-192x192.png"), Badge: strp("/android-icon-72x72.png"), URL: strp("/dashboard"),
		Tag: strp("test-notification"), RequireInter: boolp(false)})
	if err != nil {
		h.fail(w, msg, public, err)
		return
	}
	h.d.Log.Info("Test notification sent", "userId", uid, "sentCount", res.Sent, "removedCount", res.Removed, "failedCount", res.Failed)
	out := httpx.O("ok", true, "sentCount", res.Sent, "removedCount", res.Removed, "failedCount", res.Failed)
	if len(res.Errors) > 0 {
		out.Set("errors", res.ErrorsJSON())
	}
	httpx.JSON(w, http.StatusOK, out)
}
