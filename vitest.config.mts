import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

import { spaAliases } from './web/aliases';

export default defineConfig({
  // In sandboxed/CI environments, the repo root may contain a gitignored `.env`
  // that isn't readable. Point Vite/Vitest at a dedicated envDir instead.
  envDir: '.vitest-env',
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true, // This is needed by @testing-library to be cleaned up after each test
    // Prefer process forks for better memory isolation. A single long-lived worker can
    // accumulate too much heap across the full suite, so keep a small fork pool instead.
    pool: 'forks',
    maxWorkers: 2,
    isolate: true,
    coverage: {
      include: ['src/**/*'],
      exclude: ['src/**/*.stories.{js,jsx,ts,tsx}', '**/*.d.ts'],
    },
    setupFiles: ['./vitest-setup.ts'],
    reporters: ['verbose'],
    testTimeout: 5 * 1000,
    // Vitest 4 removed `environmentMatchGlobs`. Use `projects` with inline
    // configs to apply per-glob environments. Both projects inherit root opts.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.{js,ts}'],
          exclude: ['src/hooks/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          include: [
            'src/**/*.test.{jsx,tsx}',
            'src/hooks/**/*.test.ts',
          ],
          environment: 'jsdom',
        },
      },
      {
        extends: true,
        test: {
          // The SPA's shims and router (web/src).
          name: 'web',
          alias: spaAliases(false),
          include: ['web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
