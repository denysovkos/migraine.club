import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { envShim, spaAliases } from './aliases';

const here = path.dirname(fileURLToPath(import.meta.url));
// The repository root: .env files live there, and so do node_modules and
// the shared packages the dev server reads.
const repo = path.resolve(here, '../..');

const goProxy = { '^/(api|\\.well-known|monitoring|umami)(/|$|\\?)': 'http://localhost:3000' };

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repo, ''), ...process.env };
  const mockAuth = env.E2E_MOCK_AUTH === 'true';
  const publicEnv = Object.fromEntries(Object.entries(env)
    .filter(([k]) => k.startsWith('NEXT_PUBLIC_'))
    .flatMap(([k, v]) => [[`import.meta.env.${k}`, JSON.stringify(v)], [`process.env.${k}`, JSON.stringify(v)]]));
  return {
    root: here,
    publicDir: path.resolve(here, 'public'),
    // The same PostCSS pipeline as Next (postcss.config.js: Tailwind, cssnano).
    css: { postcss: here },
    plugins: [envShim(), react()],
    define: {
      ...publicEnv,
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      'import.meta.env.VITE_E2E_MOCK_USER_ID': JSON.stringify(env.E2E_MOCK_USER_ID ?? ''),
    },
    resolve: {
      alias: spaAliases(mockAuth),
    },
    // `npm run dev` / `vite preview`: the SPA on :3002, everything the Go
    // server answers itself (npm run dev:server, :3000) proxied to it.
    server: { port: 3002, fs: { allow: [repo] }, proxy: goProxy },
    preview: { port: 3002, proxy: goProxy },
    build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true },
  };
});
