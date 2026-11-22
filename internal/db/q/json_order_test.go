package q

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Every model must marshal: the generated key lists have to match the
// struct's JSON tags exactly, or MarshalJSON errors.
func TestEveryModelMarshals(t *testing.T) {
	for _, v := range allModels() {
		_, err := json.Marshal(v)
		require.NoError(t, err, reflect.TypeOf(v).Name())
	}
}

func TestOrderFollowsDrizzle(t *testing.T) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false) // as httpx.Marshal does
	require.NoError(t, enc.Encode(User{ID: "u", DisplayName: "<b>"}))
	s := buf.String()
	require.True(t, strings.HasPrefix(s, `{"id":"u","stripeCustomerId":null`))
	require.Less(t, strings.Index(s, `"displayName"`), strings.Index(s, `"updatedAt"`))
	require.Contains(t, s, `"displayName":"<b>"`)
}
