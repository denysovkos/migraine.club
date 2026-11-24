// Package config reads the environment the server runs with.
//
// The variable names and the validation rules are the ones src/libs/Env.ts
// enforced in the Node server, so the same Render environment boots either.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config is the validated environment.
type Config struct {
	Port string

	ClerkSecretKey      string
	ClerkPublishableKey string
	ClerkSignInURL      string

	DatabaseURL       string
	DatabasePoolMax   int32
	RunMigrationsBoot bool

	LogtailSourceToken string

	StripeSecretKey      string
	StripeWebhookSecret  string
	StripePublishableKey string
	BillingPlanEnv       string

	OpenWeatherMapAPIKey    string
	OpenWeatherMapTimeoutMs int

	VAPIDPrivateKey string
	VAPIDPublicKey  string
	VAPIDSubject    string

	CronSecret string

	EnableInsights             bool
	EnableStaleEpisodeReminder bool

	FilesStoragePath string

	E2EMockAuth   bool
	E2EMockUserID string

	AppURL    string
	SentryDSN string
	// ServerSentryDSN is the server's own Sentry project (SENTRY_DSN);
	// SentryDSN is the browser's, which the /monitoring tunnel forwards to.
	ServerSentryDSN string
	// CSPEnforce sends the Content-Security-Policy enforced instead of
	// report-only (CSP_ENFORCE=true).
	CSPEnforce bool
	NodeEnv    string
}

// coerceBool mirrors zod's z.coerce.boolean(): Boolean(value), so any
// non-empty string (including "false") is true and unset is false.
func coerceBool(v string) bool { return v != "" }

func required(name string, errs *[]string) string {
	v := os.Getenv(name)
	if v == "" {
		*errs = append(*errs, name+": Required")
	}
	return v
}

// Load reads and validates the environment.
func Load() (*Config, error) {
	var errs []string
	c := &Config{
		Port:                 envOr("PORT", "3000"),
		ClerkSecretKey:       required("CLERK_SECRET_KEY", &errs),
		ClerkPublishableKey:  required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", &errs),
		ClerkSignInURL:       required("NEXT_PUBLIC_CLERK_SIGN_IN_URL", &errs),
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		RunMigrationsBoot:    os.Getenv("RUN_MIGRATIONS_ON_BOOT") != "false",
		LogtailSourceToken:   os.Getenv("LOGTAIL_SOURCE_TOKEN"),
		StripeSecretKey:      required("STRIPE_SECRET_KEY", &errs),
		StripeWebhookSecret:  required("STRIPE_WEBHOOK_SECRET", &errs),
		StripePublishableKey: required("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", &errs),
		BillingPlanEnv:       os.Getenv("BILLING_PLAN_ENV"),
		OpenWeatherMapAPIKey: os.Getenv("OPENWEATHERMAP_API_KEY"),
		VAPIDPrivateKey:      os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDPublicKey:       os.Getenv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
		VAPIDSubject:         os.Getenv("VAPID_SUBJECT"),
		CronSecret:           os.Getenv("CRON_SECRET"),
		EnableInsights:       coerceBool(os.Getenv("ENABLE_F39_INSIGHTS")),
		EnableStaleEpisodeReminder: coerceBool(
			os.Getenv("ENABLE_STALE_EPISODE_REMINDER")),
		FilesStoragePath: os.Getenv("FILES_STORAGE_PATH"),
		E2EMockAuth:      os.Getenv("E2E_MOCK_AUTH") == "true",
		E2EMockUserID:    os.Getenv("E2E_MOCK_USER_ID"),
		AppURL:           os.Getenv("NEXT_PUBLIC_APP_URL"),
		SentryDSN:        os.Getenv("NEXT_PUBLIC_SENTRY_DSN"),
		ServerSentryDSN:  os.Getenv("SENTRY_DSN"),
		CSPEnforce:       os.Getenv("CSP_ENFORCE") == "true",
		NodeEnv:          os.Getenv("NODE_ENV"),
	}

	switch c.BillingPlanEnv {
	case "dev", "test", "prod":
	default:
		errs = append(errs, "BILLING_PLAN_ENV: Invalid enum value. Expected 'dev' | 'test' | 'prod'")
	}

	if v := os.Getenv("DATABASE_POOL_MAX"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			errs = append(errs, "DATABASE_POOL_MAX: Expected number")
		}
		c.DatabasePoolMax = int32(n)
	}
	if v := os.Getenv("OPENWEATHERMAP_TIMEOUT_MS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			errs = append(errs, "OPENWEATHERMAP_TIMEOUT_MS: Expected number")
		}
		c.OpenWeatherMapTimeoutMs = n
	}
	switch c.NodeEnv {
	case "", "test", "development", "production":
	default:
		errs = append(errs, "NODE_ENV: Invalid enum value")
	}

	if len(errs) > 0 {
		return nil, fmt.Errorf("invalid environment variables:\n  %s", strings.Join(errs, "\n  "))
	}
	return c, nil
}

// MockUserID is the synthetic user every request belongs to under
// E2E_MOCK_AUTH (src/libs/E2EAuth.ts).
func (c *Config) MockUserID() string {
	if c.E2EMockUserID != "" {
		return c.E2EMockUserID
	}
	return DefaultMockUserID
}

// DefaultMockUserID matches E2E_MOCK_USER_ID_DEFAULT.
const DefaultMockUserID = "e2e_user_test_001"

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

// ErrNoDatabase is returned when DATABASE_URL is missing. The Node server fell
// back to an in-process PGlite; the Go server needs a real Postgres.
var ErrNoDatabase = errors.New("DATABASE_URL is required")
