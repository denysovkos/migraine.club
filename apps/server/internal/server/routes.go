package server

import (
	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/api/alerts"
	"github.com/denysovkos/migraine.club/internal/api/community"
	"github.com/denysovkos/migraine.club/internal/api/cron"
	"github.com/denysovkos/migraine.club/internal/api/cycle"
	"github.com/denysovkos/migraine.club/internal/api/diary"
	"github.com/denysovkos/migraine.club/internal/api/doctors"
	"github.com/denysovkos/migraine.club/internal/api/episodes"
	"github.com/denysovkos/migraine.club/internal/api/factors"
	"github.com/denysovkos/migraine.club/internal/api/insights"
	"github.com/denysovkos/migraine.club/internal/api/intake"
	"github.com/denysovkos/migraine.club/internal/api/mcpapi"
	"github.com/denysovkos/migraine.club/internal/api/meds"
	"github.com/denysovkos/migraine.club/internal/api/outcomes"
	"github.com/denysovkos/migraine.club/internal/api/preventives"
	"github.com/denysovkos/migraine.club/internal/api/programs"
	pushapi "github.com/denysovkos/migraine.club/internal/api/push"
	"github.com/denysovkos/migraine.club/internal/api/questionnaires"
	"github.com/denysovkos/migraine.club/internal/api/reports"
	"github.com/denysovkos/migraine.club/internal/api/share"
	"github.com/denysovkos/migraine.club/internal/api/user"
	"github.com/denysovkos/migraine.club/internal/api/weather"
	"github.com/denysovkos/migraine.club/internal/app"
)

// mountAPI registers every ported API route.
func mountAPI(r chi.Router, d *app.Deps) {
	user.Mount(r, d)
	weather.Mount(r, d)
	episodes.Mount(r, d)
	diary.Mount(r, d)
	meds.Mount(r, d)
	factors.Mount(r, d)
	cycle.Mount(r, d)
	preventives.Mount(r, d)
	intake.Mount(r, d)
	questionnaires.Mount(r, d)
	outcomes.Mount(r, d)
	insights.Mount(r, d)
	programs.Mount(r, d)
	reports.Mount(r, d)
	alerts.Mount(r, d)
	share.Mount(r, d)
	community.Mount(r, d)
	doctors.Mount(r, d)
	pushapi.Mount(r, d)
	cron.Mount(r, d)
	mcpapi.Mount(r, d)
}
