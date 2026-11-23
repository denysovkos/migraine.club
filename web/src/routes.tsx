/* eslint-disable react-refresh/only-export-components -- route modules, not hot-reloaded components */
/**
 * The react-router tree, built from the Next app directory so every page and
 * layout module renders unchanged:
 *
 * - `(group)` folders are pathless layouts, `[param]` a dynamic segment,
 *   `[[...rest]]` an optional catch-all.
 * - The locale tree is mounted once per locale prefix (localePrefix
 *   'as-needed': English has none).
 * - Async (server) components run in the route loader with `<Outlet />` as
 *   their children; the element they return is what the route renders.
 *   Client components render directly. Params and searchParams are passed
 *   as already-settled promises, so `use()` never suspends.
 * - redirect() and notFound() thrown from those functions become react-router
 *   redirects and the Next 404 page.
 */
import type { ComponentType, ReactNode } from 'react';
import type { LoaderFunctionArgs, RouteObject } from 'react-router';
import type { Metadata } from './metadata';

import { Outlet, useLoaderData, useRouteError } from 'react-router';
import { LocaleRoot } from './LocaleRoot';
import { applyMetadata } from './metadata';
import { NotFoundPage } from './NotFoundPage';
import { DEFAULT_LOCALE, loadLocale, LOCALES } from './shims/locale-state';
import { NotFoundError } from './shims/next-navigation';

type Module = {
  default: ComponentType<any> | ((props: any) => Promise<ReactNode>);
  metadata?: Metadata;
  generateMetadata?: (props: any) => Promise<Metadata> | Metadata;
};

const modules = import.meta.glob<Module>(['../../src/app/**/page.tsx', '../../src/app/**/layout.tsx']);

/** A promise that React's use() reads synchronously. */
export function settled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status: string; value: T };
  p.status = 'fulfilled';
  p.value = value;
  return p;
}

function isAsync(fn: unknown): boolean {
  return typeof fn === 'function' && fn.constructor.name === 'AsyncFunction';
}

type Node = { segment: string; layout?: string; page?: string; children: Map<string, Node> };

function tree(prefix: string): Node {
  const root: Node = { segment: '', children: new Map() };
  for (const file of Object.keys(modules)) {
    if (!file.startsWith(prefix)) {
      continue;
    }
    const rel = file.slice(prefix.length).split('/');
    const name = rel.pop()!;
    let node = root;
    for (const seg of rel) {
      if (!node.children.has(seg)) {
        node.children.set(seg, { segment: seg, children: new Map() });
      }
      node = node.children.get(seg)!;
    }
    if (name === 'layout.tsx') {
      node.layout = file;
    } else {
      node.page = file;
    }
  }
  return root;
}

function pathOf(segment: string): string | undefined {
  if (segment.startsWith('(')) {
    return undefined;
  }
  if (/^\[\[\.\.\.\w+\]\]$/.test(segment)) {
    return '*?';
  }
  if (/^\[\.\.\.\w+\]$/.test(segment)) {
    return '*';
  }
  const param = /^\[(\w+)\]$/.exec(segment);
  return param ? `:${param[1]}` : segment;
}

/** Next's params: catch-alls are arrays, optional ones absent when empty. */
function nextParams(params: Record<string, string | undefined>, locale: string, catchAllName?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { locale };
  for (const [k, v] of Object.entries(params)) {
    if (k === '*') {
      if (catchAllName && v) {
        out[catchAllName] = v.split('/');
      }
      continue;
    }
    if (v !== undefined) {
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function catchAllOf(file: string): string | undefined {
  return /\[\[?\.\.\.(\w+)\]\]?/.exec(file)?.[1];
}

function searchParamsOf(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

type LoaderData = { element: ReactNode | null; metadata?: Metadata };

function moduleRoute(file: string, kind: 'layout' | 'page', locale: string | undefined): Pick<RouteObject, 'loader' | 'Component'> {
  return {
    loader: async ({ params, request }: LoaderFunctionArgs): Promise<LoaderData> => {
      const mod = await modules[file]!();
      const p = nextParams(params, locale ?? DEFAULT_LOCALE, catchAllOf(file));
      if (locale) {
        await loadLocale(locale);
      }
      const props = kind === 'page'
        ? { params: settled(p), searchParams: settled(searchParamsOf(new URL(request.url))) }
        : { params: settled(p), children: <Outlet /> };
      let metadata = mod.metadata;
      if (mod.generateMetadata) {
        metadata = await mod.generateMetadata({ params: settled(p), searchParams: settled(searchParamsOf(new URL(request.url))) });
      }
      if (isAsync(mod.default)) {
        const element = await (mod.default as (props: any) => Promise<ReactNode>)(props);
        return { element, metadata };
      }
      const Component = mod.default as ComponentType<any>;
      return { element: <Component {...props} />, metadata };
    },
    Component: RouteElement,
  };
}

function RouteElement() {
  const data = useLoaderData() as LoaderData;
  return <>{data.element}</>;
}

function build(node: Node, locale: string | undefined, skipLayoutAt?: string): RouteObject[] {
  const out: RouteObject[] = [];
  for (const child of node.children.values()) {
    const path = pathOf(child.segment);
    const nested: RouteObject[] = [];
    if (child.page) {
      nested.push({ index: true, ...moduleRoute(child.page, 'page', locale) });
    }
    nested.push(...build(child, locale));
    if (child.layout && child.layout !== skipLayoutAt) {
      out.push({ path, ...moduleRoute(child.layout, 'layout', locale), children: nested });
    } else if (path === undefined) {
      out.push(...nested);
    } else {
      out.push({ path, children: nested });
    }
  }
  return out;
}

function ErrorBoundary() {
  const error = useRouteError();
  if (error instanceof NotFoundError || (error as { status?: number })?.status === 404) {
    return <NotFoundPage />;
  }
  throw error;
}

/** The locale tree under one prefix ('' for the default locale). */
function localeRoutes(locale: string): RouteObject {
  const appDir = '../../src/app/[locale]/';
  const root = tree(appDir);
  const children: RouteObject[] = [];
  if (root.page) {
    children.push({ index: true, ...moduleRoute(root.page, 'page', locale) });
  }
  children.push(...build(root, locale), { path: '*', Component: NotFoundPage });
  return {
    path: locale === DEFAULT_LOCALE ? '/' : `/${locale}`,
    loader: async () => {
      await loadLocale(locale);
      return null;
    },
    element: <LocaleRoot locale={locale} />,
    ErrorBoundary,
    children,
  };
}

function plainRoutes(dir: string): RouteObject {
  const root = tree(`../../src/app/${dir}/`);
  const children = build(root, undefined);
  if (root.page) {
    children.unshift({ index: true, ...moduleRoute(root.page, 'page', undefined) });
  }
  const layout = Object.keys(modules).find(f => f === `../../src/app/${dir}/layout.tsx`);
  return {
    path: `/${dir}`,
    loader: async () => {
      await loadLocale(DEFAULT_LOCALE);
      return null;
    },
    ErrorBoundary,
    ...(layout ? moduleRoute(layout, 'layout', undefined) : { element: <Outlet /> }),
    children,
  };
}

export function routes(): RouteObject[] {
  return [
    ...LOCALES.filter(l => l !== DEFAULT_LOCALE).map(localeRoutes),
    plainRoutes('admin'),
    plainRoutes('share'),
    localeRoutes(DEFAULT_LOCALE),
  ];
}

export { applyMetadata };
