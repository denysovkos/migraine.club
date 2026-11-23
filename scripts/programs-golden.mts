// Writes internal/service/programs/testdata/definitions.json: the parsed
// program definitions and localized bodies, for the Go port.
// Run: npx tsx --tsconfig scripts/golden.tsconfig.json scripts/programs-golden.mts
import { writeFileSync } from 'node:fs';
import { getProgramBody, getProgramDefinitions } from '../src/services/programs/programDefinitions';

const out = getProgramDefinitions().map(d => ({
  frontmatter: d.frontmatter,
  bodies: Object.fromEntries(['en', 'fr', 'uk', 'de', ''].map(l => [l, getProgramBody(d.frontmatter.id, l)])),
}));
writeFileSync('internal/service/programs/testdata/definitions.json', `${JSON.stringify(out)}\n`);
console.log(out.length);
