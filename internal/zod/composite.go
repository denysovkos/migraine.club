package zod

import (
	"fmt"
	"strings"
)

// ---------- array ----------

// ArraySchema is z.array(item).
type ArraySchema struct {
	item     Schema
	min, max *int
	minMsg   string
	maxMsg   string
}

// Array is z.array(item).
func Array(item Schema) *ArraySchema { return &ArraySchema{item: item} }

func (a *ArraySchema) Min(n int, msg ...string) *ArraySchema {
	c := *a
	c.min, c.minMsg = &n, msgOr(msg, "")
	return &c
}

func (a *ArraySchema) Max(n int, msg ...string) *ArraySchema {
	c := *a
	c.max, c.maxMsg = &n, msgOr(msg, "")
	return &c
}

func (a *ArraySchema) run(v any, path []any) (any, []Issue) {
	arr, ok := v.([]any)
	if !ok {
		return nil, []Issue{invalidType("array", v, path)}
	}
	out := make([]any, len(arr))
	var issues []Issue
	for i, el := range arr {
		parsed, iss := a.item.run(el, pathWith(path, float64(i)))
		issues = append(issues, iss...)
		out[i] = parsed
	}
	if a.min != nil && len(arr) < *a.min {
		msg := fmt.Sprintf("Too small: expected array to have >=%d items", *a.min)
		if a.minMsg != "" {
			msg = a.minMsg
		}
		issues = append(issues, newIssue("origin", "array", "code", "too_small", "minimum", float64(*a.min), "inclusive", true).finish(path, msg))
	}
	if a.max != nil && len(arr) > *a.max {
		msg := fmt.Sprintf("Too big: expected array to have <=%d items", *a.max)
		if a.maxMsg != "" {
			msg = a.maxMsg
		}
		issues = append(issues, newIssue("origin", "array", "code", "too_big", "maximum", float64(*a.max), "inclusive", true).finish(path, msg))
	}
	if len(issues) > 0 {
		return nil, issues
	}
	return out, nil
}

// ---------- object ----------

// Field is one key of an object shape, in declaration order.
type Field struct {
	Key    string
	Schema Schema
}

// F declares a field.
func F(key string, s Schema) Field { return Field{key, s} }

// ObjectSchema is z.object(shape).
type ObjectSchema struct {
	fields []Field
	strict bool
}

// Object is z.object({...}). Unknown keys are stripped.
func Object(fields ...Field) *ObjectSchema { return &ObjectSchema{fields: fields} }

// Strict is .strict(): unknown keys are an error.
func (o *ObjectSchema) Strict() *ObjectSchema { return &ObjectSchema{fields: o.fields, strict: true} }

// Extend is .extend({...}).
func (o *ObjectSchema) Extend(fields ...Field) *ObjectSchema {
	merged := append([]Field{}, o.fields...)
	for _, f := range fields {
		replaced := false
		for i, existing := range merged {
			if existing.Key == f.Key {
				merged[i] = f
				replaced = true
			}
		}
		if !replaced {
			merged = append(merged, f)
		}
	}
	return &ObjectSchema{fields: merged, strict: o.strict}
}

// Partial is .partial(): every field optional.
func (o *ObjectSchema) Partial() *ObjectSchema {
	out := &ObjectSchema{strict: o.strict}
	for _, f := range o.fields {
		out.fields = append(out.fields, Field{f.Key, Optional(f.Schema)})
	}
	return out
}

func (o *ObjectSchema) run(v any, path []any) (any, []Issue) {
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, []Issue{invalidType("object", v, path)}
	}
	out := map[string]any{}
	var issues []Issue
	known := map[string]bool{}
	for _, f := range o.fields {
		known[f.Key] = true
		val, present := obj[f.Key]
		if !present {
			val = Undefined
		}
		parsed, iss := f.Schema.run(val, pathWith(path, f.Key))
		if len(iss) > 0 {
			issues = append(issues, iss...)
			continue
		}
		if _, undef := parsed.(undefinedT); undef {
			continue
		}
		out[f.Key] = parsed
	}
	if o.strict {
		var extra []any
		for k := range obj {
			if !known[k] {
				extra = append(extra, k)
			}
		}
		if len(extra) > 0 {
			// Report keys in input order is not available from a Go map;
			// sort them for determinism.
			sortAny(extra)
			label := "key"
			if len(extra) > 1 {
				label = "keys"
			}
			issues = append(issues, newIssue("code", "unrecognized_keys", "keys", extra).
				finish(path, fmt.Sprintf("Unrecognized %s: %s", label, joinValues(extra, ", "))))
		}
	}
	if len(issues) > 0 {
		return nil, issues
	}
	return out, nil
}

func sortAny(xs []any) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0 && fmt.Sprint(xs[j]) < fmt.Sprint(xs[j-1]); j-- {
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}

// ---------- wrappers ----------

type optionalSchema struct{ inner Schema }

// Optional is .optional(): a missing value passes through as missing.
func Optional(s Schema) Schema { return optionalSchema{s} }

func (o optionalSchema) run(v any, path []any) (any, []Issue) {
	if _, undef := v.(undefinedT); undef {
		return Undefined, nil
	}
	return o.inner.run(v, path)
}

type nullableSchema struct{ inner Schema }

// Nullable is .nullable().
func Nullable(s Schema) Schema { return nullableSchema{s} }

func (n nullableSchema) run(v any, path []any) (any, []Issue) {
	if v == nil {
		return nil, nil
	}
	return n.inner.run(v, path)
}

// Nullish is .nullish().
func Nullish(s Schema) Schema { return Optional(Nullable(s)) }

type defaultSchema struct {
	inner Schema
	def   func() any
}

// Default is .default(value). value is copied for every parse.
func Default(s Schema, value any) Schema {
	return defaultSchema{inner: s, def: func() any { return cloneJSON(value) }}
}

func (d defaultSchema) run(v any, path []any) (any, []Issue) {
	if _, undef := v.(undefinedT); undef {
		return d.def(), nil
	}
	return d.inner.run(v, path)
}

type catchSchema struct {
	inner Schema
	value any
}

// Catch is .catch(value): any failure yields value instead.
func Catch(s Schema, value any) Schema { return catchSchema{s, value} }

func (c catchSchema) run(v any, path []any) (any, []Issue) {
	out, iss := c.inner.run(v, path)
	if len(iss) > 0 {
		return cloneJSON(c.value), nil
	}
	return out, nil
}

func cloneJSON(v any) any {
	switch x := v.(type) {
	case []any:
		out := make([]any, len(x))
		for i, el := range x {
			out[i] = cloneJSON(el)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, el := range x {
			out[k] = cloneJSON(el)
		}
		return out
	case int:
		return float64(x)
	default:
		return v
	}
}

// ---------- union ----------

type unionSchema struct{ options []Schema }

// Union is z.union([...]): the first option that parses wins.
func Union(options ...Schema) Schema { return unionSchema{options} }

// run is Zod v4's handleUnionResults: the first option without issues wins;
// when exactly one option failed only on soft checks (issues that let parsing
// continue), its issues are reported as they are; otherwise one invalid_union
// carries every option's issues, with paths relative to the union.
func (u unionSchema) run(v any, path []any) (any, []Issue) {
	var all [][]Issue
	soft := -1
	softCount := 0
	for i, opt := range u.options {
		out, iss := opt.run(v, []any{})
		if len(iss) == 0 {
			return out, nil
		}
		all = append(all, iss)
		if !aborted(iss) {
			soft, softCount = i, softCount+1
		}
	}
	if softCount == 1 {
		return u.options[soft].run(v, path)
	}
	return nil, []Issue{newIssue("code", "invalid_union", "errors", all).finish(path, "Invalid input")}
}

// continuing are the issue codes Zod's checks raise with continue: true;
// type, value, union and key errors abort.
var continuing = map[string]bool{"too_small": true, "too_big": true, "invalid_format": true, "not_multiple_of": true, "custom": true}

// aborted is util.aborted: some issue stops parsing.
func aborted(issues []Issue) bool {
	for _, is := range issues {
		if !continuing[is.Code()] {
			return true
		}
	}
	return false
}

type discriminatedSchema struct {
	key     string
	options []*ObjectSchema
}

// DiscriminatedUnion is z.discriminatedUnion(key, [...]). Each option must
// declare key as a Literal.
func DiscriminatedUnion(key string, options ...*ObjectSchema) Schema {
	return discriminatedSchema{key, options}
}

func (d discriminatedSchema) literalOf(o *ObjectSchema) any {
	for _, f := range o.fields {
		if f.Key == d.key {
			if e, ok := f.Schema.(enumSchema); ok && len(e.values) == 1 {
				return e.values[0]
			}
		}
	}
	return nil
}

func (d discriminatedSchema) run(v any, path []any) (any, []Issue) {
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, []Issue{invalidType("object", v, path)}
	}
	tag := obj[d.key]
	var opts []any
	for _, o := range d.options {
		lit := d.literalOf(o)
		opts = append(opts, lit)
		if lit == tag {
			return o.run(v, path)
		}
	}
	quoted := make([]string, len(opts))
	for i, o := range opts {
		quoted[i] = "'" + fmt.Sprint(o) + "'"
	}
	return nil, []Issue{newIssue("code", "invalid_union", "errors", [][]Issue{}, "note", "No matching discriminator",
		"discriminator", d.key, "options", opts).
		finish(pathWith(path, d.key), "Invalid discriminator value. Expected "+strings.Join(quoted, " | "))}
}

// ---------- record ----------

type recordSchema struct{ key, value Schema }

// Record is z.record(keySchema, valueSchema).
func Record(key, value Schema) Schema { return recordSchema{key, value} }

func (r recordSchema) run(v any, path []any) (any, []Issue) {
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, []Issue{invalidType("record", v, path)}
	}
	out := map[string]any{}
	var issues []Issue
	for k, val := range obj {
		if _, iss := r.key.run(k, pathWith(path, k)); len(iss) > 0 {
			issues = append(issues, iss...)
			continue
		}
		parsed, iss := r.value.run(val, pathWith(path, k))
		issues = append(issues, iss...)
		out[k] = parsed
	}
	if len(issues) > 0 {
		return nil, issues
	}
	return out, nil
}

// ---------- refinements and transforms ----------

// Ctx lets a SuperRefine callback add issues.
type Ctx struct {
	path   []any
	issues []Issue
}

// AddIssue adds a custom issue at the given sub-path.
func (c *Ctx) AddIssue(message string, subpath ...any) {
	p := append(append([]any{}, c.path...), subpath...)
	c.issues = append(c.issues, newIssue("code", "custom").finish(p, message))
}

type refineSchema struct {
	inner Schema
	fn    func(any, *Ctx)
}

// Refine is .refine(fn, { message, path }). fn sees the parsed value and only
// runs when the inner schema succeeded, as in Zod.
func Refine(s Schema, ok func(any) bool, message string, path ...any) Schema {
	return refineSchema{inner: s, fn: func(v any, ctx *Ctx) {
		if !ok(v) {
			ctx.AddIssue(message, path...)
		}
	}}
}

// SuperRefine is .superRefine(fn).
func SuperRefine(s Schema, fn func(any, *Ctx)) Schema { return refineSchema{inner: s, fn: fn} }

func (r refineSchema) run(v any, path []any) (any, []Issue) {
	out, iss := r.inner.run(v, path)
	if len(iss) > 0 {
		return nil, iss
	}
	ctx := &Ctx{path: path}
	r.fn(out, ctx)
	if len(ctx.issues) > 0 {
		return nil, ctx.issues
	}
	return out, nil
}

type transformSchema struct {
	inner Schema
	fn    func(any) any
}

// Transform is .transform(fn).
func Transform(s Schema, fn func(any) any) Schema { return transformSchema{s, fn} }

func (t transformSchema) run(v any, path []any) (any, []Issue) {
	out, iss := t.inner.run(v, path)
	if len(iss) > 0 {
		return nil, iss
	}
	return t.fn(out), nil
}
