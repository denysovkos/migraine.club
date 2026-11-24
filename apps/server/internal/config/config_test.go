package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func setRequired(t *testing.T) {
	t.Setenv("CLERK_SECRET_KEY", "sk_test_x")
	t.Setenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x")
	t.Setenv("NEXT_PUBLIC_CLERK_SIGN_IN_URL", "/sign-in")
	t.Setenv("STRIPE_SECRET_KEY", "sk")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "wh")
	t.Setenv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk")
	t.Setenv("BILLING_PLAN_ENV", "test")
}

func TestLoadRequiresTheSameVariablesAsEnvTs(t *testing.T) {
	for _, k := range []string{"CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "NEXT_PUBLIC_CLERK_SIGN_IN_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"} {
		t.Run(k, func(t *testing.T) {
			setRequired(t)
			t.Setenv(k, "")
			_, err := Load()
			require.ErrorContains(t, err, k)
		})
	}
}

func TestLoadValidatesBillingPlanEnv(t *testing.T) {
	setRequired(t)
	t.Setenv("BILLING_PLAN_ENV", "staging")
	_, err := Load()
	require.ErrorContains(t, err, "BILLING_PLAN_ENV")
}

func TestCoercedBooleansFollowZod(t *testing.T) {
	setRequired(t)
	t.Setenv("ENABLE_F39_INSIGHTS", "false") // Boolean("false") === true
	t.Setenv("ENABLE_STALE_EPISODE_REMINDER", "")
	c, err := Load()
	require.NoError(t, err)
	require.True(t, c.EnableInsights)
	require.False(t, c.EnableStaleEpisodeReminder)
}

func TestDefaults(t *testing.T) {
	setRequired(t)
	t.Setenv("PORT", "")
	t.Setenv("RUN_MIGRATIONS_ON_BOOT", "")
	t.Setenv("E2E_MOCK_USER_ID", "")
	c, err := Load()
	require.NoError(t, err)
	require.Equal(t, "3000", c.Port)
	require.True(t, c.RunMigrationsBoot)
	require.Equal(t, "e2e_user_test_001", c.MockUserID())

	t.Setenv("RUN_MIGRATIONS_ON_BOOT", "false")
	t.Setenv("DATABASE_POOL_MAX", "7")
	c, err = Load()
	require.NoError(t, err)
	require.False(t, c.RunMigrationsBoot)
	require.EqualValues(t, 7, c.DatabasePoolMax)
}
