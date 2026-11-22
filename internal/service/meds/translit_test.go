package meds

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTransliteration(t *testing.T) {
	require.True(t, ContainsCyrillic("ібупрофен"))
	require.False(t, ContainsCyrillic("ibuprofen"))
	first := func(s string) string { return CyrillicToLatinVariants(s, 1)[0] }
	require.Equal(t, "ibuprofen", first("ібупрофен"))
	require.Equal(t, "nurofen", first("нурофен"))
	require.Equal(t, "maritab markayin", first("МАРІТАБ маркаїн"))
	vars := CyrillicToLatinVariants("золміг", 4)
	require.Contains(t, vars, "zolmig")
	require.Contains(t, vars, "zolmih")
	require.Len(t, CyrillicToLatinVariants("гиги", 3), 3)
}
