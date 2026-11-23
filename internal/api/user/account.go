package user

import (
	"net/http"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/dataexport"
)

type accountHandlers struct{ d *app.Deps }

// export is GET /api/user/export?format=json|csv.
func (h accountHandlers) export(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	format := "json"
	if v, ok := r.URL.Query()["format"]; ok {
		format = v[0]
	}
	if format != "json" && format != "csv" {
		httpx.Error(w, http.StatusBadRequest, "Invalid format. Use json or csv.")
		return
	}
	fail := func(err error) {
		h.d.Log.Error("Error generating user data export", "userId", uid, "error", err)
		httpx.Error(w, http.StatusInternalServerError, "Failed to export data")
	}
	now := h.d.Clock()
	data, err := dataexport.Collect(r.Context(), h.d.Pool, uid, jsontime.New(now).Time)
	if err != nil {
		fail(err)
		return
	}
	base := dataexport.FileBaseName(now)
	h.d.Log.Info("User data export generated", "userId", uid, "format", format, "rows", data.CountRows())

	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if format == "csv" {
		archive, err := data.CSVArchive()
		if err != nil {
			w.Header().Del("Cache-Control")
			w.Header().Del("X-Content-Type-Options")
			fail(err)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+base+`-csv.zip"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(archive)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+base+`.json"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data.JSON())
}

// deleteStatements is the deletion order of DELETE /api/user/delete-account.
var deleteStatements = []string{
	`DELETE FROM community_vote WHERE user_id = $1`,
	`DELETE FROM community_comment WHERE author_id = $1`,
	`DELETE FROM community_post WHERE author_id = $1`,
	`DELETE FROM doctor_share_link WHERE user_id = $1`,
	`DELETE FROM weather_pain_index_snapshot WHERE user_id = $1`,
	`DELETE FROM user_weather_settings WHERE user_id = $1`,
	`DELETE FROM episode WHERE user_id = $1`,
	`DELETE FROM cycle_bleeding_day WHERE user_id = $1`,
	`DELETE FROM cycle_settings WHERE user_id = $1`,
	`UPDATE user_consent SET withdrawn_at = $2 WHERE user_id = $1`,
	`DELETE FROM "user" WHERE id = $1`,
}

// deleteAccount is DELETE /api/user/delete-account.
func (h accountHandlers) deleteAccount(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	h.d.Log.Info("Starting account deletion", "userId", uid)
	ctx := r.Context()
	for _, sql := range deleteStatements {
		args := []any{uid}
		if len(sql) > 6 && sql[:6] == "UPDATE" {
			args = append(args, jsontime.New(h.d.Clock()))
		}
		tag, err := h.d.Pool.Exec(ctx, sql, args...)
		if err != nil {
			h.d.Log.Error("Error deleting user account", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "Failed to delete account. Please try again or contact support.")
			return
		}
		if sql == deleteStatements[6] {
			h.d.Log.Info("Episodes deleted", "userId", uid, "episodesDeleted", tag.RowsAffected())
		}
	}
	if h.d.Clerk == nil {
		h.d.Log.Error("Failed to delete Clerk user", "userId", uid, "error", "no Clerk client")
	} else if err := h.d.Clerk.DeleteUser(ctx, uid); err != nil {
		// Data is already removed; Clerk failures are only logged.
		h.d.Log.Error("Failed to delete Clerk user", "userId", uid, "error", err)
	} else {
		h.d.Log.Info("Clerk user deleted", "userId", uid)
	}
	h.d.Log.Info("Account deletion completed", "userId", uid)
	httpx.JSON(w, http.StatusOK, httpx.O("success", true, "message", "Account and all associated data have been deleted"))
}
