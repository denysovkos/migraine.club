import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = (f: string) => path.resolve(here, 'spa/shims', f);

/**
 * The Next modules the SPA replaces, for the Vite build and the web unit
 * tests alike. With mockAuth the E2E mock Clerk stands in for the real one.
 */
export function spaAliases(mockAuth: boolean): { find: RegExp; replacement: string }[] {
  return [
    { find: /^next\/link$/, replacement: shim('next-link.tsx') },
    { find: /^next\/navigation$/, replacement: shim('next-navigation.ts') },
    { find: /^next\/script$/, replacement: shim('next-script.tsx') },
    { find: /^next\/headers$/, replacement: shim('next-headers.ts') },
    { find: /^next\/font\/google$/, replacement: shim('next-font-google.ts') },
    { find: /^next-intl\/server$/, replacement: shim('next-intl-server.ts') },
    { find: /^next-intl\/navigation$/, replacement: shim('next-intl-navigation.ts') },
    { find: /^@\/libs\/Env$/, replacement: shim('env.ts') },
    { find: /^@clerk\/nextjs\/server$/, replacement: mockAuth ? shim('clerk-server-mock.ts') : shim('clerk-server.ts') },
    { find: /^@clerk\/nextjs$/, replacement: mockAuth ? path.resolve(here, 'src/libs/MockClerk.tsx') : shim('clerk.tsx') },
    { find: /^@\//, replacement: `${path.resolve(here, 'src')}/` },
  ];
}

/**
 * src/libs/Env.ts validates server secrets. Modules in src/libs import it
 * as './Env', which the aliases above never see; this sends every import
 * that resolves to it to the SPA's version.
 */
export function envShim() {
  const real = path.resolve(here, 'src/libs/Env');
  return {
    name: 'spa-env-shim',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (importer && source.startsWith('.') && path.resolve(path.dirname(importer), source).replace(/\.ts$/, '') === real) {
        return shim('env.ts');
      }
      return null;
    },
  };
}
