package zod

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOrderedKeepsShapeOrder(t *testing.T) {
	s := Object(
		F("zeta", Nullable(Object(F("b", Number()), F("a", Array(Object(F("y", String()), F("x", Optional(String())))))))),
		F("alpha", Default(Nullable(String()), nil)),
		F("mid", DiscriminatedUnion("k", Object(F("k", Literal("p")), F("v", Number())))),
	)
	in, err := Decode([]byte(`{"mid":{"v":1,"k":"p"},"zeta":{"a":[{"x":"1","y":"2"},{"y":"3"}],"b":2},"extra":1}`))
	require.NoError(t, err)
	out, err := Parse(s, in)
	require.NoError(t, err)
	b, err := marshalJS(Ordered(s, out))
	require.NoError(t, err)
	require.Equal(t, `{"zeta":{"b":2,"a":[{"y":"2","x":"1"},{"y":"3"}]},"alpha":null,"mid":{"k":"p","v":1}}`, string(b))
}
