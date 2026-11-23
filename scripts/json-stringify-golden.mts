// Writes internal/jsx/testdata/stringify.json: JSON.stringify(JSON.parse(x))
// compact and with a two-space indent, for jsx.Restringify's golden test.
// Run: npx tsx scripts/json-stringify-golden.mts
import { mkdirSync, writeFileSync } from 'node:fs';

const inputs = [
  'null',
  'true',
  '0',
  '-0',
  '1.0',
  '1e2',
  '1E+21',
  '1e21',
  '1e-7',
  '0.000001',
  '123456789012345678901234',
  '0.1',
  '-1.5e-10',
  '9007199254740993',
  '1.7976931348623157e308',
  '5e-324',
  '2.5e-8',
  '"plain"',
  '"a\\u2028b\\u2029c"',
  '"\\u0001\\u001f\\u007f"',
  '"\\b\\f\\n\\r\\t\\/\\"\\\\"',
  '"emoji 😀 \\ud83d\\ude00"',
  '"<script>&amp;</script>"',
  '"\\ud800 lone"',
  '"\\udc00"',
  '[]',
  '{}',
  '[[],{}]',
  '[1,[2,[3]]]',
  '{"b":1,"a":2}',
  '{"10":1,"2":2,"a":3,"1":4}',
  '{"01":1,"1":2,"-1":3,"1.5":4}',
  '{"4294967294":1,"4294967295":2,"0":3}',
  '{"a":1,"b":2,"a":3}',
  '{"nested": {"z": [1, {"y": null, "0": "x"}], "k": "v"}, "list": [ ]}',
  '  {"ws" :\n [ 1 , 2 ] }  ',
];

const out = inputs.map((input) => {
  const v = JSON.parse(input);
  return { input, compact: JSON.stringify(v), indented: JSON.stringify(v, null, 2) };
});
mkdirSync('internal/jsx/testdata', { recursive: true });
writeFileSync('internal/jsx/testdata/stringify.json', `${JSON.stringify(out, null, 2)}\n`);
