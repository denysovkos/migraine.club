package zod

import "bytes"

// OrderedObject is a parsed object that marshals its keys in the order Zod
// built them: the schema's shape order, which is what JSON.stringify sent.
type OrderedObject struct {
	Keys   []string
	Values map[string]any
}

// MarshalJSON writes the keys in order.
func (o OrderedObject) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.Keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := marshalPlain(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := marshalJS(o.Values[k])
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// Get returns a key's value.
func (o OrderedObject) Get(k string) (any, bool) { v, ok := o.Values[k]; return v, ok }

// Ordered rewrites a value Parse returned for s so its objects keep the
// schema's key order. Unions use the first option the value satisfies;
// records and transformed values keep Go's sorted map order.
func Ordered(s Schema, v any) any {
	switch x := s.(type) {
	case *ObjectSchema:
		m, ok := v.(map[string]any)
		if !ok {
			return v
		}
		out := OrderedObject{Values: map[string]any{}}
		for _, f := range x.fields {
			if val, ok := m[f.Key]; ok {
				out.Keys = append(out.Keys, f.Key)
				out.Values[f.Key] = Ordered(f.Schema, val)
			}
		}
		return out
	case *ArraySchema:
		arr, ok := v.([]any)
		if !ok {
			return v
		}
		out := make([]any, len(arr))
		for i, el := range arr {
			out[i] = Ordered(x.item, el)
		}
		return out
	case optionalSchema:
		return Ordered(x.inner, v)
	case nullableSchema:
		return Ordered(x.inner, v)
	case defaultSchema:
		return Ordered(x.inner, v)
	case catchSchema:
		return Ordered(x.inner, v)
	case refineSchema:
		return Ordered(x.inner, v)
	case unionSchema:
		for _, opt := range x.options {
			if _, iss := opt.run(v, []any{}); len(iss) == 0 {
				return Ordered(opt, v)
			}
		}
		return v
	case discriminatedSchema:
		if m, ok := v.(map[string]any); ok {
			for _, o := range x.options {
				if x.literalOf(o) == m[x.key] {
					return Ordered(o, v)
				}
			}
		}
		return v
	default:
		return v
	}
}
