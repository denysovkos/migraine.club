// Generates internal/zod/testdata/golden.json: what real Zod v4 returns for a
// set of schemas and inputs. The Go port is tested against this file, so its
// issues, messages and parsed output stay byte-for-byte what the Node API sent.
import { writeFileSync } from 'node:fs';
import { z } from 'zod';

const cases: Array<{ name: string; schema: z.ZodTypeAny; inputs: unknown[] }> = [
  { name: 'string', schema: z.string(), inputs: ['a', 1, null, undefined, true, [], {}] },
  { name: 'string_min_max', schema: z.string().min(2).max(4), inputs: ['a', 'ab', 'abcde'] },
  { name: 'string_trim_min', schema: z.string().trim().min(1).max(3), inputs: ['  ', ' ab ', ' abcd '] },
  { name: 'string_length', schema: z.string().length(3), inputs: ['ab', 'abc', 'abcd'] },
  { name: 'string_uuid', schema: z.string().uuid(), inputs: ['x', '7c1d3e2a-1b2c-4d5e-8f90-1234567890ab', '00000000-0000-0000-0000-000000000000'] },
  { name: 'string_guid', schema: z.string().guid(), inputs: ['x', '7C1D3E2A-1B2C-4D5E-8F90-1234567890AB'] },
  { name: 'string_email', schema: z.string().email(), inputs: ['a@b.co', 'nope'] },
  { name: 'string_url', schema: z.string().url(), inputs: ['https://x.y/z', 'nope'] },
  { name: 'string_datetime', schema: z.string().datetime(), inputs: ['2026-01-02T03:04:05Z', '2026-01-02T03:04:05.123Z', '2026-01-02T03:04:05+02:00', '2026-01-02', 'x'] },
  { name: 'string_datetime_offset', schema: z.string().datetime({ offset: true }), inputs: ['2026-01-02T03:04:05+02:00', '2026-01-02T03:04:05Z', '2026-01-02T03:04'] },
  { name: 'string_regex', schema: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), inputs: ['2026-01-02', '2026-1-2'] },
  { name: 'string_regex_msg', schema: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM'), inputs: ['12:30', '1230'] },
  { name: 'string_min_msg', schema: z.string().min(1, 'Name is required'), inputs: [''] },
  { name: 'number', schema: z.number(), inputs: [1, 1.5, '1', null, Number.NaN, undefined] },
  { name: 'number_int_range', schema: z.number().int().min(1).max(5), inputs: [0, 1, 2.5, 6] },
  { name: 'number_positive', schema: z.number().positive(), inputs: [0, -1, 1] },
  { name: 'number_nonnegative', schema: z.number().nonnegative(), inputs: [-1, 0] },
  { name: 'number_gt_lt', schema: z.number().gt(0).lt(10), inputs: [0, 10, 5] },
  { name: 'coerce_number', schema: z.coerce.number().int().min(1), inputs: ['3', '0', 'abc', '', null, 2] },
  { name: 'boolean', schema: z.boolean(), inputs: [true, 'true', 1] },
  { name: 'enum', schema: z.enum(['a', 'b', 'c']), inputs: ['a', 'd', 1] },
  { name: 'enum_one', schema: z.enum(['only']), inputs: ['x'] },
  { name: 'literal', schema: z.literal('x'), inputs: ['x', 'y'] },
  { name: 'literal_num', schema: z.literal(3), inputs: [3, 4] },
  { name: 'array', schema: z.array(z.string()).min(1).max(2), inputs: [[], ['a'], ['a', 'b', 'c'], 'x', [1]] },
  { name: 'optional', schema: z.string().optional(), inputs: [undefined, 'a', null] },
  { name: 'nullable', schema: z.string().nullable(), inputs: [null, 'a', undefined] },
  { name: 'nullish', schema: z.string().nullish(), inputs: [null, undefined, 1] },
  { name: 'default', schema: z.number().default(5), inputs: [undefined, 2, null] },
  { name: 'object', schema: z.object({ a: z.string(), b: z.number().optional(), c: z.boolean().default(false) }), inputs: [{ a: 'x' }, { a: 'x', b: 2, c: true, extra: 1 }, {}, { a: 1, b: 'x' }, null, 'x', []] },
  { name: 'object_nested', schema: z.object({ p: z.object({ q: z.array(z.object({ r: z.number().max(3) })) }) }), inputs: [{ p: { q: [{ r: 1 }, { r: 9 }] } }, { p: {} }] },
  { name: 'object_strict', schema: z.object({ a: z.string() }).strict(), inputs: [{ a: 'x', b: 1 }, { a: 'x', b: 1, c: 2 }] },
  { name: 'union', schema: z.union([z.string(), z.number()]), inputs: ['a', 1, true] },
  { name: 'discriminated', schema: z.discriminatedUnion('kind', [z.object({ kind: z.literal('a'), x: z.number() }), z.object({ kind: z.literal('b'), y: z.string() })]), inputs: [{ kind: 'a', x: 1 }, { kind: 'b', y: 1 }, { kind: 'c' }, {}] },
  { name: 'record', schema: z.record(z.string(), z.number()), inputs: [{ a: 1 }, { a: 'x' }] },
  { name: 'refine', schema: z.object({ from: z.string(), to: z.string() }).refine(v => v.from <= v.to, { message: 'from must be before to', path: ['to'] }), inputs: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] },
  { name: 'refine_root', schema: z.number().refine(v => v % 2 === 0, 'Must be even'), inputs: [2, 3] },
  { name: 'refine_with_field_error', schema: z.object({ a: z.number(), b: z.number() }).refine(v => v.a < v.b, 'a<b'), inputs: [{ a: 'x', b: 1 }, { a: 2, b: 1 }] },
  { name: 'object_defaults', schema: z.object({ n: z.number().int().default(3), s: z.string().optional(), l: z.array(z.string()).default([]) }), inputs: [{}, { s: 'x', n: 4 }] },
  { name: 'catch', schema: z.object({ n: z.number().catch(7) }), inputs: [{ n: 'x' }, { n: 1 }] },
  { name: 'coerce_boolean', schema: z.coerce.boolean(), inputs: ['false', '', 0, 1, null] },
  { name: 'lowercase', schema: z.string().trim().toLowerCase().email(), inputs: [' A@B.CO ', 'X'] },
  { name: 'multi_check', schema: z.string().min(5).regex(/^a/), inputs: ['b'] },
  { name: 'nullable_obj_field', schema: z.object({ x: z.string().nullable().optional(), y: z.number().nullable() }), inputs: [{ y: null }, {}, { x: null, y: 1 }] },
  { name: 'array_of_objects', schema: z.array(z.object({ id: z.string().guid(), v: z.number().min(0).max(10) })).max(3), inputs: [[{ id: '7c1d3e2a-1b2c-4d5e-8f90-1234567890ab', v: 11 }], [{ id: 'x', v: 1 }]] },
  { name: 'int_unsafe', schema: z.number().int(), inputs: [2 ** 53 + 2, 1e300] },
  { name: 'unknown', schema: z.object({ u: z.unknown() }), inputs: [{}, { u: [1, { a: 2 }] }] },
  { name: 'null', schema: z.null(), inputs: [null, 0] },
  { name: 'starts_ends', schema: z.string().startsWith('ab').endsWith('yz'), inputs: ['abxyz', 'xx'] },
  { name: 'union_nested', schema: z.object({ p: z.union([z.null(), z.object({ n: z.number().int().positive() }), z.array(z.number().int().min(1).max(7)), z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))]).nullish() }), inputs: [{ p: null }, { p: { n: 2 } }, { p: { n: 0 } }, { p: { n: 1.5 } }, { p: [1, 'a'] }, { p: [9] }, { p: ['x'] }, { p: 'x' }, {}, { p: [[1]] }] },
  { name: 'union_checks', schema: z.union([z.string().min(3), z.number().max(2)]), inputs: ['ab', 5, true, 'abc'] },
  { name: 'union_two_soft', schema: z.object({ u: z.union([z.string().min(5), z.string().max(1)]) }), inputs: [{ u: 'abc' }, { u: 'a' }] },
  { name: 'super_refine', schema: z.object({ a: z.object({ x: z.number() }).superRefine((v, ctx) => {
    if (v.x > 1) {
      ctx.addIssue({ code: 'custom', message: 'too big' });
      ctx.addIssue({ code: 'custom', message: 'with path', path: ['x'] });
    }
  }) }), inputs: [{ a: { x: 1 } }, { a: { x: 2 } }] },
  { name: 'native_enum_like', schema: z.nativeEnum({ A: 'a', B: 'b' } as const), inputs: ['a', 'z'] },
];

const out = cases.map(({ name, schema, inputs }) => ({
  name,
  results: inputs.map((input) => {
    const r = schema.safeParse(input);
    return r.success
      ? { input: input === undefined ? '__undefined__' : input, success: true, data: r.data === undefined ? '__undefined__' : r.data }
      : { input: input === undefined ? '__undefined__' : input, success: false, issues: JSON.parse(JSON.stringify(r.error.issues)), message: r.error.message, flatten: z.flattenError(r.error) };
  }),
}));
writeFileSync('internal/zod/testdata/golden.json', `${JSON.stringify(out, null, 2)}\n`);
