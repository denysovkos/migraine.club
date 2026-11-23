package i18n_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/i18n"
)

func TestTranslator(t *testing.T) {
	tr, err := i18n.New("", "Push")
	require.NoError(t, err)
	require.Equal(t, "Migrennity test", tr("test.title"))
	require.Equal(t, "High Weather Pain Index (7.5/10).", tr("dailyRisk.wpiPart", "score", 7.5))
	require.Equal(t, "on ", tr("pressureDrop.onDay", "weekday", nil))
	require.Equal(t, "Push.missing.key", tr("missing.key"))
	require.Equal(t, "Push.dailyRisk", tr("dailyRisk"))
	uk, err := i18n.New("uk", "Push")
	require.NoError(t, err)
	require.NotEqual(t, tr("test.title"), uk("test.body"))
	_, err = i18n.New("de", "Push")
	require.Error(t, err)
}
