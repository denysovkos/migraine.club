import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const shim = (f: string) => path.resolve(here, 'src/shims', f);

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
    { find: /^@clerk\/nextjs$/, replacement: mockAuth ? path.resolve(repo, 'src/libs/MockClerk.tsx') : shim('clerk.tsx') },
    { find: /^@\//, replacement: `${path.resolve(repo, 'src')}/` },
  ];
}
