package programs_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/service/programs"
)

func s(v string) *string { return &v }

func TestSleepSignal(t *testing.T) {
	target := programs.SleepTarget{BedTime: "23:00", WakeTime: "07:00", ToleranceMinutes: 30}
	require.Equal(t, "hit", programs.SleepSignal(target, s("23:18"), s("06:52")))
	require.Equal(t, "hit", programs.SleepSignal(target, s("22:30"), s("07:30")))
	require.Equal(t, "miss", programs.SleepSignal(target, s("01:30"), s("07:00")))
	require.Equal(t, "miss", programs.SleepSignal(target, s("23:00"), s("08:30")))
	require.Equal(t, "na", programs.SleepSignal(target, nil, s("07:00")))
	require.Equal(t, "na", programs.SleepSignal(target, s("23:00"), nil))
	require.Equal(t, "na", programs.SleepSignal(target, nil, nil))
	require.Equal(t, "miss", programs.SleepSignal(target, s("00:30"), s("07:00")), "midnight wrap is +90 min")
	wide := target
	wide.ToleranceMinutes = 90
	require.Equal(t, "hit", programs.SleepSignal(wide, s("00:25"), s("07:00")))
	// Stored times read back as HH:MM:SS still compare by hour and minute.
	require.Equal(t, "hit", programs.SleepSignal(target, s("23:10:00"), s("07:05:00")))
}
