/**
 * Captures every route of tests/visual/routes.ts from one server: a
 * full-page screenshot, the normalised body HTML, the final URL, the HTTP
 * status and the document title, at phone and desktop width.
 *
 * Usage: node --import tsx tests/visual/capture.mts <baseURL> <outDir> [filter]
 * Env: VISUAL_NOW (ISO time the browser clock is pinned to; both servers'
 * captures must use the same value).
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
  const body = document.body.cloneNode(true);
  body.querySelectorAll('script, noscript, next-route-announcer, nextjs-portal, link[rel="preload"], style[data-visual-freeze]').forEach(n => n.remove());
  return body.innerHTML.replace(/ data-(?:nextjs|next)[\\w-]*="[^"]*"/g, '');
})()`;

async function main() {
  const [base, out, filter] = process.argv.slice(2);
  if (!base || !out) {
    throw new Error('usage: capture.mts <baseURL> <outDir> [filter]');
  }
  const now = new Date(process.env.VISUAL_NOW ?? new Date().toISOString());
  mkdirSync(out, { recursive: true });
  // VISUAL_CHROMIUM points at a preinstalled browser when Playwright's own is missing.
  const browser = await chromium.launch(process.env.VISUAL_CHROMIUM ? { executablePath: process.env.VISUAL_CHROMIUM } : {});
  const index: Record<string, unknown> = {};
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: 'light',
      timezoneId: 'Europe/Berlin',
      locale: 'en-US',
      baseURL: base,
    });
    for (const route of routes().filter(r => !filter || r.includes(filter))) {
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
      index[name] = {
        route,
        status: res?.status() ?? null,
        url: page.url().replace(base, ''),
        title: await page.title(),
        lang: await page.evaluate(() => document.documentElement.lang),
        errors,
      };
      await page.close();
    }
    await context.close();
  }
  writeFileSync(path.join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  await browser.close();
}

await main();
