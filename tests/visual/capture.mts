/**
 * Captures every route of tests/visual/routes.ts from one server: a
 * full-page screenshot, the normalised body HTML, the final URL, the HTTP
 * status and the document title, at phone and desktop width.
 *
 * Usage: node --import tsx tests/visual/capture.mts <baseURL[,baseURL...]> <outDir[,outDir...]> [filter]
 * Env: VISUAL_NOW (ISO time the browser clock is pinned to; both servers'
 * captures must use the same value).
 *
 * With several servers each route is captured on all of them one after the
 * other, so times computed from now() on the server side (seed rows, "3 days
 * ago") agree between the captures.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { routes } from './routes';

export const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

export function slug(route: string): string {
  return route === '/' ? 'root' : route.replace(/^\//, '').replace(/[^\w-]+/g, '_');
}

const FREEZE = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`;

/** Body HTML without the parts each framework injects on its own. */
const NORMALISE = `(() => {
  // Server-rendered markup keeps React's style string and selected options;
  // the browser re-serialises both when React sets them on the client.
  const values = [...document.body.querySelectorAll('select')].map(s => s.value);
  const body = document.body.cloneNode(true);
  body.querySelectorAll('[style]').forEach(el => el.setAttribute('style', el.style.cssText));
  body.querySelectorAll('select').forEach((s, i) => {
    s.setAttribute('data-value', values[i]);
    s.querySelectorAll('option').forEach(o => o.removeAttribute('selected'));
  });
  body.querySelectorAll('script, noscript, next-route-announcer, nextjs-portal, link[rel="preload"], style[data-visual-freeze]').forEach(n => n.remove());
  // React streaming markers (comments, and the hidden div Next parks them
  // in) never render.
  return body.innerHTML
    .replace(/<!--[\\s\\S]*?-->/g, '')
    .replace(/<div hidden=""><\\/div>/g, '')
    .replace(/ data-(?:nextjs|next)[\\w-]*="[^"]*"/g, '')
    // useId values differ between server and client rendering; number them
    // in order of appearance.
    .replace(/_[rR]_[\\w]*?_/g, ((ids) => (id) => {
      if (!ids.has(id)) {
        ids.set(id, '_id' + ids.size + '_');
      }
      return ids.get(id);
    })(new Map()));
})()`;

async function main() {
  const [baseArg, outArg, filter] = process.argv.slice(2);
  const bases = (baseArg ?? '').split(',').filter(Boolean);
  const outs = (outArg ?? '').split(',').filter(Boolean);
  if (!bases.length || bases.length !== outs.length) {
    throw new Error('usage: capture.mts <baseURL[,baseURL...]> <outDir[,outDir...]> [filter]');
  }
  const now = new Date(process.env.VISUAL_NOW ?? new Date().toISOString());
  outs.forEach(out => mkdirSync(out, { recursive: true }));
  // VISUAL_CHROMIUM points at a preinstalled browser when Playwright's own is missing.
  const browser = await chromium.launch(process.env.VISUAL_CHROMIUM ? { executablePath: process.env.VISUAL_CHROMIUM } : {});
  const indexes: Record<string, unknown>[] = outs.map(() => ({}));
  await Promise.all(VIEWPORTS.map(async (vp) => {
    const contexts = await Promise.all(bases.map(async (base) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        colorScheme: 'light',
        timezoneId: 'Europe/Berlin',
        locale: 'en-US',
        baseURL: base,
      });
      // Third-party scripts (tag manager, analytics) never load: every
      // server is captured offline alike.
      const origin = new URL(base).origin;
      await context.route(url => new URL(url).origin !== origin, route => route.abort());
      return context;
    }));
    for (const route of routes().filter(r => !filter || r.includes(filter))) {
      for (const [i, context] of contexts.entries()) {
        const base = bases[i]!;
        const out = outs[i]!;
        const page = await context.newPage();
        await page.clock.install({ time: now });
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(String(e)));
        const res = await page.goto(route, { waitUntil: 'networkidle' }).catch(() => null);
        await page.addStyleTag({ content: FREEZE }).then(h => h.evaluate(n => (n as Element).setAttribute('data-visual-freeze', ''))).catch(() => {});
        await page.waitForTimeout(400);
        const name = `${slug(route)}__${vp.name}`;
        await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true, animations: 'disabled' });
        writeFileSync(path.join(out, `${name}.html`), await page.evaluate(NORMALISE));
        indexes[i]![name] = {
          route,
          status: res?.status() ?? null,
          url: page.url().replace(base, ''),
          title: await page.title(),
          lang: await page.evaluate(() => document.documentElement.lang),
          errors,
        };
        await page.close();
      }
    }
    await Promise.all(contexts.map(c => c.close()));
  }));
  outs.forEach((out, i) => writeFileSync(path.join(out, 'index.json'), `${JSON.stringify(indexes[i], null, 2)}\n`));
  await browser.close();
}

await main();
