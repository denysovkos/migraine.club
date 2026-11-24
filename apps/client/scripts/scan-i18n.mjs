#!/usr/bin/env node
/**
 * Static scan for missing translation keys (scope-aware).
 *
 * Uses TypeScript's compiler API to walk every source file and bind
 * each `useTranslations('NS')` call to the variable it assigns to,
 * scoped to the enclosing function. Then resolves every t('key') in
 * scope back to its namespace and checks the locale JSON.
 *
 * Dynamic keys (t(`prefix_${x}`)) report the namespace + prefix; if
 * zero matching keys exist for any of the enumerated values, the
 * prefix is flagged.
 *
 * Run: node scripts/scan-i18n.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const LOCALES_DIR = path.join(SRC, 'locales');

async function loadLocale(name) {
  const raw = await fs.readFile(path.join(LOCALES_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw);
}

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const child of flatten(v, p)) {
        out.add(child);
      }
    } else {
      out.add(p);
    }
  }
  return out;
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'locales') {
        continue;
      }
      await walk(full, out);
    } else if (/\.(?:tsx?|mts|cts)$/.test(e.name)
      && !/\.test\.|\.spec\.|\.stories\.|MockClerk/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * For one source file, return:
 *   - bindings:  Map<binderName, namespace> per scope
 *   - usages:    list of { binder, key } resolved against an enclosing scope
 *   - tplUsages: list of { ns, prefix } from template literal calls
 */
function analyseFile(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  /** stack of scopes; each scope is Map<binderName, namespace> */
  const scopeStack = [new Map()];
  const usages = [];
  const tplUsages = [];

  function pushScope() {
    scopeStack.push(new Map());
  }
  function popScope() {
    scopeStack.pop();
  }
  function bind(name, ns) {
    scopeStack[scopeStack.length - 1].set(name, ns);
  }
  function lookup(name) {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const s = scopeStack[i];
      if (s.has(name)) {
        return s.get(name);
      }
    }
    return null;
  }

  function visit(node) {
    let openedScope = false;

    if (
      ts.isFunctionDeclaration(node)
      || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node)
      || ts.isConstructorDeclaration(node)
      || ts.isGetAccessor(node)
      || ts.isSetAccessor(node)
    ) {
      pushScope();
      openedScope = true;
    }

    // Bindings: `const X = useTranslations('NS')`
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = node.initializer;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'useTranslations') {
        const arg = init.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          const ns = arg.text;
          if (ts.isIdentifier(node.name)) {
            bind(node.name.text, ns);
          }
        }
      }
    }

    // Bindings via getTranslations({ namespace: 'NS' })
    if (ts.isVariableDeclaration(node) && node.initializer
      && ts.isAwaitExpression(node.initializer)
      && ts.isCallExpression(node.initializer.expression)
      && ts.isIdentifier(node.initializer.expression.expression)
      && node.initializer.expression.expression.text === 'getTranslations') {
      const arg = node.initializer.expression.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) {
          if (ts.isPropertyAssignment(p)
            && ts.isIdentifier(p.name)
            && p.name.text === 'namespace'
            && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) {
            if (ts.isIdentifier(node.name)) {
              bind(node.name.text, p.initializer.text);
            }
          }
        }
      }
    }

    // Usages: `X('key')` or `X(`prefix_${x}`)`
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binderName = node.expression.text;
      const ns = lookup(binderName);
      if (ns && node.arguments.length > 0) {
        const a0 = node.arguments[0];
        if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) {
          usages.push({ ns, key: a0.text });
        } else if (ts.isTemplateExpression(a0)) {
          // head + spans
          const head = a0.head.text;
          // We only flag prefix patterns like `prefix_${expr}` where head ends with `_` (common in this codebase)
          if (head && head.length > 0) {
            tplUsages.push({ ns, head });
          }
        }
      }
    }

    ts.forEachChild(node, visit);

    if (openedScope) {
      popScope();
    }
  }

  visit(sf);
  return { usages, tplUsages };
}

async function main() {
  const en = flatten(await loadLocale('en'));
  const fr = flatten(await loadLocale('fr'));
  const uk = flatten(await loadLocale('uk'));

  const files = await walk(SRC);
  const missing = { en: new Map(), fr: new Map(), uk: new Map() };
  const tplMissing = new Map();

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    let analysed;
    try {
      analysed = analyseFile(file, text);
    } catch (err) {
      console.error(`parse failed: ${file}: ${err.message}`);
      continue;
    }

    for (const { ns, key } of analysed.usages) {
      const full = `${ns}.${key}`;
      for (const [loc, set] of [['en', en], ['fr', fr], ['uk', uk]]) {
        if (!set.has(full)) {
          if (!missing[loc].has(ns)) {
            missing[loc].set(ns, new Set());
          }
          missing[loc].get(ns).add(key);
        }
      }
    }

    for (const { ns, head } of analysed.tplUsages) {
      const prefix = `${ns}.${head}`;
      const anyEn = [...en].some(k => k.startsWith(prefix));
      if (!anyEn) {
        tplMissing.set(prefix, file);
      }
    }
  }

  const report = (label, map) => {
    if (map.size === 0) {
      console.log(`\n✅ ${label}: clean`);
      return false;
    }
    const total = [...map.values()].reduce((n, s) => n + s.size, 0);
    console.log(`\n❌ ${label}: missing ${total} keys across ${map.size} namespaces`);
    for (const [ns, keys] of [...map.entries()].sort()) {
      console.log(`  ${ns}:`);
      for (const k of [...keys].sort()) {
        console.log(`    - ${k}`);
      }
    }
    return true;
  };

  let bad = false;
  if (report('en.json', missing.en)) {
    bad = true;
  }
  if (report('fr.json', missing.fr)) {
    bad = true;
  }
  if (report('uk.json', missing.uk)) {
    bad = true;
  }

  if (tplMissing.size > 0) {
    console.log(`\n⚠️  Template prefixes with zero matches in en.json:`);
    for (const [prefix, file] of tplMissing) {
      console.log(`  ${prefix}*  (${path.relative(ROOT, file)})`);
    }
    bad = true;
  } else {
    console.log('\n✅ template-key prefixes all resolve');
  }

  process.exit(bad ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
