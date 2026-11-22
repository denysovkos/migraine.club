// Package idem makes client writes safe to replay
// (src/app/api/_helpers/idempotency.ts).
//
// Entries logged offline are queued on the device and may be sent more than
// once. A queued write carries a stable Idempotency-Key; a key produces at most
// one side effect per user. Requests without the header are unaffected.
package idem

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
)

// Header names.
const (
	KeyHeader         = "Idempotency-Key"
	OfflineUserHeader = "X-Offline-User"
)

var keyRe = regexp.MustCompile(`^[\w-]{8,100}$`)

// staleReservation is how long a reservation without a stored response is
// considered in progress before another request may take it over.
const staleReservation = 2 * time.Minute

// recorder captures a handler's response so it can be stored.
type recorder struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *recorder) Header() http.Header { return r.header }
func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.body.Write(b)
}
func (r *recorder) WriteHeader(s int) {
	if r.status == 0 {
		r.status = s
	}
}

// Wrap runs handler at most once per (user, Idempotency-Key). Only 2xx
// responses are remembered; any other outcome releases the key so a
// corrected retry can succeed.
func Wrap(qs *q.Queries, log *slog.Logger, now func() time.Time, w http.ResponseWriter, r *http.Request, userID, route string, handler http.HandlerFunc) {
	if v := r.Header.Get(OfflineUserHeader); v != "" && v != userID {
		httpx.JSON(w, http.StatusConflict, httpx.O(
			"error", "This entry was saved by a different account on this device.", "code", "OFFLINE_USER_MISMATCH"))
		return
	}
	key := r.Header.Get(KeyHeader)
	if key == "" {
		handler(w, r)
		return
	}
	if !keyRe.MatchString(key) {
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Invalid Idempotency-Key", "code", "INVALID_IDEMPOTENCY_KEY"))
		return
	}
	ctx := r.Context()
	kind, stored, err := reserve(ctx, qs, now(), userID, key, route)
	if err != nil {
		log.Error("idempotency reserve failed", "error", err)
		httpx.Internal(w)
		return
	}
	switch kind {
	case completed:
		w.Header().Set("Idempotent-Replayed", "true")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(int(*stored.ResponseStatus))
		body := stored.ResponseBody
		if len(body) == 0 {
			body = []byte("null")
		}
		_, _ = w.Write(body)
		return
	case inProgress:
		w.Header().Set("Retry-After", "5")
		httpx.JSON(w, http.StatusConflict, httpx.O("error", "The same entry is already being saved.", "code", "IDEMPOTENCY_IN_PROGRESS"))
		return
	}

	rec := &recorder{header: http.Header{}}
	func() {
		defer func() {
			if p := recover(); p != nil {
				_ = qs.ReleaseIdempotencyKey(context.WithoutCancel(ctx), userID, key)
				panic(p)
			}
		}()
		handler(rec, r)
	}()
	if rec.status == 0 {
		rec.status = http.StatusOK
	}

	if rec.status >= 200 && rec.status < 300 {
		body := rec.body.Bytes()
		var stored []byte
		if _, err := httpx.ParseBody(body); err == nil {
			stored = body
		} else {
			stored = []byte("null")
		}
		status := int32(rec.status)
		if err := qs.CompleteIdempotencyKey(ctx, &status, stored, userID, key); err != nil {
			log.Warn("Failed to record idempotent response", "userId", userID, "route", route, "error", err)
		}
	} else if err := qs.ReleaseIdempotencyKey(ctx, userID, key); err != nil {
		log.Warn("Failed to record idempotent response", "userId", userID, "route", route, "error", err)
	}

	for k, v := range rec.header {
		w.Header()[k] = v
	}
	w.WriteHeader(rec.status)
	_, _ = w.Write(rec.body.Bytes())
}

type reservation int

const (
	reserved reservation = iota
	completed
	inProgress
)

func reserve(ctx context.Context, qs *q.Queries, now time.Time, userID, key, route string) (reservation, q.GetIdempotentResponseRow, error) {
	ids, err := qs.ReserveIdempotencyKey(ctx, userID, key, route)
	if err != nil {
		return 0, q.GetIdempotentResponseRow{}, err
	}
	if len(ids) > 0 {
		return reserved, q.GetIdempotentResponseRow{}, nil
	}
	existing, err := qs.GetIdempotentResponse(ctx, userID, key)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, existing, err
	}
	if err == nil && existing.ResponseStatus != nil {
		return completed, existing, nil
	}
	taken, err := qs.TakeOverIdempotencyKey(ctx, q.TakeOverIdempotencyKeyParams{
		Now: jsontime.New(now), Route: route, UserID: userID, IdempotencyKey: key,
		StaleBefore: jsontime.New(now.Add(-staleReservation)),
	})
	if err != nil {
		return 0, existing, err
	}
	if len(taken) > 0 {
		return reserved, existing, nil
	}
	return inProgress, existing, nil
}

// ResolveCapturedAt is resolveCapturedAt: a client-captured timestamp for an
// entry that may be synced late. Empty means fallback. Times in the future
// (beyond skew) or older than maxAgeDays are rejected; small positive skew is
// clamped to fallback.
func ResolveCapturedAt(iso string, fallback time.Time, maxAgeDays int, skew time.Duration) (time.Time, string) {
	if iso == "" {
		return fallback, ""
	}
	at, err := jsontime.Parse(iso)
	if err != nil {
		return time.Time{}, "Invalid timestamp"
	}
	if maxAgeDays == 0 {
		maxAgeDays = 30
	}
	if skew == 0 {
		skew = 5 * time.Minute
	}
	if at.After(fallback.Add(skew)) {
		return time.Time{}, "Timestamp is in the future"
	}
	if at.Before(fallback.Add(-time.Duration(maxAgeDays) * 24 * time.Hour)) {
		return time.Time{}, "Timestamp is too old to sync"
	}
	if at.After(fallback) {
		return fallback, ""
	}
	return at, ""
}
