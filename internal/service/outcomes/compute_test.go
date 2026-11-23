package outcomes

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/localdate"
)

func ts(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }

// Ported from src/services/outcomes/computeOutcomes.test.ts.

func TestBucketsMedicationDaysByTimezone(t *testing.T) {
	require.Equal(t, "2024-01-15", localdate.String(ts("2024-01-14T23:30:00Z"), "Europe/Berlin"))
	r := ComputeForRange("Europe/Berlin", 28, "2024-01-14", "2024-01-15", nil,
		[]MedicationIntake{{TakenAt: ts("2024-01-14T23:30:00Z"), Name: " Ibu "}})
	require.False(t, r.Daily[0].TookMedication)
	require.True(t, r.Daily[1].TookMedication)
	require.Equal(t, []string{"Ibu"}, r.Daily[1].Medications)
}

func TestCountsMedicationDaysAsDistinctLocalDays(t *testing.T) {
	r := ComputeForRange("UTC", 28, "2024-01-01", "2024-01-03", nil, []MedicationIntake{
		{TakenAt: ts("2024-01-01T08:00:00Z")}, {TakenAt: ts("2024-01-01T12:00:00Z")}, {TakenAt: ts("2024-01-03T00:01:00Z")},
	})
	require.Equal(t, 2, r.Totals.AcuteMedicationDays)
}

func TestMissingDiaryDaysAreNotHeadacheFree(t *testing.T) {
	r := ComputeForRange("UTC", 28, "2024-01-01", "2024-01-03", []DiaryDay{{"2024-01-02", "headache_free"}}, nil)
	require.Equal(t, Coverage{TotalDays: 3, RecordedDays: 1, MissingDays: 2}, r.Totals.Coverage)
	require.Equal(t, 0, r.Totals.MmdMin)
	require.Equal(t, 2, r.Totals.MmdMax)
	require.Nil(t, r.Daily[0].DayType)
}

func TestCountsMhdMmdAmongRecordedDays(t *testing.T) {
	r := ComputeForRange("UTC", 28, "2024-01-01", "2024-01-03", []DiaryDay{
		{"2024-01-01", "migraine_day"}, {"2024-01-02", "headache_day"}, {"2024-01-03", "headache_free"},
	}, nil)
	require.Equal(t, 1, r.Totals.MmdMin)
	require.Equal(t, 2, r.Totals.MhdMin)
}

func TestConservativeRanges(t *testing.T) {
	r := ComputeForRange("UTC", 28, "2024-01-01", "2024-01-03", []DiaryDay{{"2024-01-02", "migraine_day"}}, nil)
	require.Equal(t, 1, r.Totals.MmdMin)
	require.Equal(t, 3, r.Totals.MmdMax)
}

func TestMedicationNamesSortedAndDeduplicated(t *testing.T) {
	r := ComputeForRange("UTC", 1, "2024-01-01", "2024-01-01", nil, []MedicationIntake{
		{TakenAt: ts("2024-01-01T08:00:00Z"), Name: "b"}, {TakenAt: ts("2024-01-01T09:00:00Z"), Name: "a"},
		{TakenAt: ts("2024-01-01T10:00:00Z"), Name: "b "}, {TakenAt: ts("2024-01-01T11:00:00Z"), Name: "  "},
	})
	require.Equal(t, []string{"a", "b"}, r.Daily[0].Medications)
}

func TestResponder50(t *testing.T) {
	require.Equal(t, Responder50{Status: "NA"}, ComputeResponder50(0, 2))
	require.Equal(t, "YES", ComputeResponder50(10, 5).Status)
	require.Equal(t, "YES", ComputeResponder50(10, 4).Status)
	require.Equal(t, "NO", ComputeResponder50(10, 6).Status)
}
