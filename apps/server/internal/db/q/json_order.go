package q

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
)

var tagIndex sync.Map // reflect.Type -> map[string]int

func fieldsByTag(t reflect.Type) map[string]int {
	if v, ok := tagIndex.Load(t); ok {
		return v.(map[string]int)
	}
	m := map[string]int{}
	for i := range t.NumField() {
		tag := strings.Split(t.Field(i).Tag.Get("json"), ",")[0]
		if tag != "" && tag != "-" {
			m[tag] = i
		}
	}
	tagIndex.Store(t, m)
	return m
}

// marshalOrdered encodes a model like JSON.stringify(row) did: keys in the
// given order, no HTML escaping.
func marshalOrdered(v any, keys []string) ([]byte, error) {
	rv := reflect.ValueOf(v)
	if n := len(fieldsByTag(rv.Type())); n != len(keys) {
		return nil, fmt.Errorf("q: %s has %d JSON fields but the schema lists %d", rv.Type().Name(), n, len(keys))
	}
	return MarshalKeys(v, keys)
}

// Table is one entry of Tables.
type Table struct {
	// Keys are Drizzle's property names, Columns the matching column names.
	Keys, Columns []string
	// Scan reads `SELECT *` rows into the table's model.
	Scan func(pgx.Rows) ([]any, error)
}

func scanAll[T any](rows pgx.Rows) ([]any, error) {
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[T])
	if err != nil {
		return nil, err
	}
	out := make([]any, len(list))
	for i, v := range list {
		out[i] = v
	}
	return out, nil
}

// MarshalKeys encodes a model with only the given keys, in that order: what
// Drizzle returned for select({...}) of those columns.
func MarshalKeys(v any, keys []string) ([]byte, error) {
	rv := reflect.ValueOf(v)
	idx := fieldsByTag(rv.Type())
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range keys {
		fi, ok := idx[k]
		if !ok {
			return nil, fmt.Errorf("q: %s has no field for %q", rv.Type().Name(), k)
		}
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		var fb bytes.Buffer
		enc := json.NewEncoder(&fb)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(rv.Field(fi).Interface()); err != nil {
			return nil, err
		}
		b.Write(bytes.TrimSuffix(fb.Bytes(), []byte("\n")))
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}
