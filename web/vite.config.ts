import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const shim = (f: string) => path.resolve(here, 'src/shims', f);

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repo, ''), ...process.env };
  const mockAuth = env.E2E_MOCK_AUTH === 'true';
  const publicEnv = Object.fromEntries(Object.entries(env)
    .filter(([k]) => k.startsWith('NEXT_PUBLIC_'))
    .flatMap(([k, v]) => [[`import.meta.env.${k}`, JSON.stringify(v)], [`process.env.${k}`, JSON.stringify(v)]]));
  return {
    root: here,
    publicDir: path.resolve(repo, 'public'),
    // The same PostCSS pipeline as Next (postcss.config.js: Tailwind, cssnano).
    css: { postcss: repo },
    plugins: [react()],
    define: {
      ...publicEnv,
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      'import.meta.env.VITE_E2E_MOCK_USER_ID': JSON.stringify(env.E2E_MOCK_USER_ID ?? ''),
    },
    resolve: {
      alias: [
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
      ],
    },
    server: { fs: { allow: [repo] } },
    // Until Go serves the SPA: API and metadata routes go to the Go server.
    preview: { port: 3002, proxy: { '^/(api|\\.well-known|share/.*/pdf)': 'http://localhost:3000' } },
    build: { outDir: path.resolve(repo, 'web/dist'), emptyOutDir: true },
  };
});
