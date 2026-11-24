package questionnaires

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/zod"
)

// Ported from scoring.test.ts, with exact MSQ values.

func TestHit6(t *testing.T) {
	s, err := Score("HIT6", map[string]any{"q1": "NEVER", "q2": "RARELY", "q3": "SOMETIMES", "q4": "VERY_OFTEN", "q5": "ALWAYS", "q6": "NEVER"})
	require.NoError(t, err)
	require.Equal(t, int32(54), s.Total)
	require.Nil(t, s.Details)
	_, err = Score("HIT6", map[string]any{"q1": "SOMETIMES"})
	require.IsType(t, &zod.Error{}, err)
}

func TestMidas(t *testing.T) {
	s, err := Score("MIDAS", map[string]any{"q1": 1.0, "q2": 2.0, "q3": 3.0, "q4": 4.0, "q5": 5.0})
	require.NoError(t, err)
	require.Equal(t, int32(15), s.Total)
	require.Equal(t, map[string]any{"grade": "Grade III"}, s.Details)
	for total, grade := range map[float64]string{0: "Grade I", 5: "Grade I", 6: "Grade II", 10: "Grade II", 11: "Grade III", 20: "Grade III", 21: "Grade IV", 100: "Grade IV"} {
		require.Equal(t, grade, MidasGrade(total))
	}
}

func TestMsq21(t *testing.T) {
	a := map[string]any{}
	for i, v := range []float64{1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2} {
		a[[]string{"q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13", "q14"}[i]] = v
	}
	s, err := Score("MSQ21", a)
	require.NoError(t, err)
	d := s.Details.(zod.OrderedObject).Values["domains"].(zod.OrderedObject).Values
	// restrictive (22/7-1)/5*100 = 42.857 -> 42.9; preventive 14/4 -> 50; emotional 9/3 -> 40; total 45/14 -> 44.3
	require.Equal(t, 42.9, d["restrictive"])
	require.Equal(t, 50.0, d["preventive"])
	require.Equal(t, 40.0, d["emotional"])
	require.Equal(t, 44.3, d["total"])
	require.Equal(t, int32(44), s.Total)
}
