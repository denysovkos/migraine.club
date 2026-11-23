package insights

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Reference values come from the TS seededRng.ts / bhFdr.ts.

func TestSeededRng(t *testing.T) {
	require.Equal(t, int32(1335831723), hashStringToSeed32("hello"))
	require.Equal(t, int32(471680687), hashStringToSeed32("юзер:controls:1700000000000"))
	r := newRng(hashStringToSeed32("hello"))
	var seq []uint32
	for range 5 {
		seq = append(seq, r.nextUint32())
	}
	require.Equal(t, []uint32{3947441262, 374729356, 3414417102, 3138558595, 3759364834}, seq)
	require.Equal(t, uint32(3388403996), newRng(0).nextUint32())
	r = newRng(123)
	for range 100 {
		require.Contains(t, []int{5, 6, 7}, r.intn(5, 7))
	}
}

func TestBenjaminiHochberg(t *testing.T) {
	require.Empty(t, benjaminiHochberg(nil))
	require.Equal(t, []float64{0.049999999999999996, 0.05, 0.049999999999999996, 0.2, 0.049999999999999996},
		benjaminiHochberg([]float64{0.01, 0.04, 0.03, 0.2, 0.03}))
}

func TestFisherAndWilson(t *testing.T) {
	require.InDelta(t, 1.0, fisherP(2, 4, 2, 4), 1e-12)
	require.Less(t, fisherP(9, 10, 1, 10), 0.01)
	lo, hi := wilson(0, 0)
	require.Equal(t, [2]float64{0, 1}, [2]float64{lo, hi})
	lo, hi = wilson(5, 10)
	require.InDelta(t, 0.2366, lo, 1e-4)
	require.InDelta(t, 0.7634, hi, 1e-4)
}
