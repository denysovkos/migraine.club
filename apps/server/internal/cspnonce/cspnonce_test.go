package cspnonce

import (
	"context"
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNonce(t *testing.T) {
	a, b := New(), New()
	require.NotEqual(t, a, b)
	raw, err := base64.StdEncoding.DecodeString(a)
	require.NoError(t, err)
	require.Len(t, raw, 16)

	require.Empty(t, From(context.Background()))
	require.Equal(t, a, From(With(context.Background(), a)))
}
