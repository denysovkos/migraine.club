import { readdirSync, statSync, writeFileSync } from 'node:fs';
/**
 * Build-time output the Next server rendered and the Go server now serves:
 *
 * - heads.json: the <head> metadata of every page in every locale, from the
 *   pages' own `metadata` / `generateMetadata` and `viewport` exports,
 *   resolved and rendered by Next's metadata code (a build-only dependency),
 *   so the tags match what Next sent.
 * - robots.txt and sitemap.xml from src/app/robots.ts and sitemap.ts, which
 *   Next generated statically at build time too.
 * - routes.json: every page pattern, for the server's 404s.
 *
 * Run after `vite build`: npx tsx web/scripts/prerender.mts
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const appDir = path.join(repo, 'src/app');
const dist = path.join(repo, 'web/dist');
const require = createRequire(import.meta.url);

// Next guards its metadata modules with `server-only`, which throws outside
// the react-server condition; this script is that server.
const serverOnly = require.resolve('server-only');
require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;

const routeData = require('next/dist/build/webpack/loaders/metadata/resolve-route-data.js');
const elements = require('next/dist/lib/metadata/metadata-elements.js');
const primitives = require('next/dist/lib/metadata/metadata-resolution-primitives.js');
const resolve = require('next/dist/lib/metadata/resolve-metadata.js');

const LOCALES = ['en', 'fr', 'uk'];
const DEFAULT_LOCALE = 'en';

/** Page files with the directories from the app root down to them. */
function pages(dir: string, parents: string[] = []): { file: string; dirs: string[] }[] {
  const out: { file: string; dirs: string[] }[] = [];
  const dirs = [...parents, dir];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full !== path.join(appDir, 'api')) {
        out.push(...pages(full, dirs));
      }
    } else if (name === 'page.tsx') {
      out.push({ file: full, dirs });
    }
  }
  return out;
}

/** The URL pattern of a page directory, react-router style. */
function pattern(dirs: string[]): string {
  const segments = dirs.slice(1).map(d => path.basename(d)).filter(s => !s.startsWith('(') && s !== '[locale]').map(s => /^\[\[\.\.\.[\w-]+\]\]$/.test(s) ? '*?' : /^\[\.\.\.[\w-]+\]$/.test(s) ? '*' : s.replace(/^\[(\w+)\]$/, ':$1'));
  return `/${segments.join('/')}`;
}

async function main() {
  const vite = await createServer({ configFile: path.join(repo, 'web/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const load = (file: string) => vite.ssrLoadModule(file);
  const localeState = await load(path.join(repo, 'web/src/shims/locale-state.ts'));

  const heads: Record<string, Record<string, string>> = {};
  const routes: string[] = [];
  for (const { file, dirs } of pages(appDir)) {
    const localized = dirs.some(d => path.basename(d) === '[locale]');
    const route = pattern(dirs);
    routes.push(localized ? route : route);
    heads[route] = {};
    for (const locale of localized ? LOCALES : [DEFAULT_LOCALE]) {
      await localeState.loadLocale(locale);
      const params = localized ? { locale } : {};
      const props = { params: Promise.resolve(params), searchParams: Promise.resolve({}) };
      const metadataItems: unknown[] = [];
      const viewportItems: unknown[] = [];
      for (const dir of dirs) {
        const layout = path.join(dir, 'layout.tsx');
        const mod = statSafe(layout) ? await load(layout) : null;
        metadataItems.push([mod ? primitives.getDefinedMetadata(mod, props, { route }) : null, null]);
        viewportItems.push(mod ? primitives.getDefinedViewport(mod, props, { route }) : null);
      }
      const page = await load(file);
      metadataItems.push([primitives.getDefinedMetadata(page, props, { route }), null]);
      viewportItems.push(primitives.getDefinedViewport(page, props, { route }));
      const pathname = localized && locale !== DEFAULT_LOCALE ? `/${locale}${route === '/' ? '' : route}` : route;
      const metadata = await resolve.accumulateMetadata(route, metadataItems, pathname, { trailingSlash: false, isStaticMetadataRouteFile: false });
      const viewport = await resolve.accumulateViewport(viewportItems);
      heads[route]![locale] = renderToStaticMarkup(createElement(Fragment, null, elements.createViewportElements(viewport), elements.createMetadataElements(resolve.createSelectedMetadata(metadata))))
        // IconMark: a placeholder Next's streaming renderer drops from the HTML.
        .replace('<meta name="«nxt-icon»"/>', '');
    }
  }

  const robots = (await load(path.join(appDir, 'robots.ts'))).default();
  const sitemap = (await load(path.join(appDir, 'sitemap.ts'))).default();
  writeFileSync(path.join(dist, 'heads.json'), `${JSON.stringify(heads, null, 2)}\n`);
  writeFileSync(path.join(dist, 'routes.json'), `${JSON.stringify(routes, null, 2)}\n`);
  writeFileSync(path.join(dist, 'robots.txt'), routeData.resolveRobots(robots));
  writeFileSync(path.join(dist, 'sitemap.xml'), routeData.resolveSitemap(sitemap));
  await vite.close();
}

function statSafe(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

await main();
