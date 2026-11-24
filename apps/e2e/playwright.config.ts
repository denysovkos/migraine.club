import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

// Use process.env.PORT by default and fallback to port 3000
const PORT = process.env.PORT || 3000;

export const E2E_FILES_STORAGE_PATH = process.env.FILES_STORAGE_PATH || path.join(os.tmpdir(), 'migraine-club-e2e-files');

// Set webServer.url and use.baseURL with the location of the WebServer respecting the correct set port
const baseURL = `http://localhost:${PORT}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  // Look for files with the .spec.js or .e2e.js extension
  testMatch: '*.@(spec|e2e).?(c|m)[jt]s?(x)',
  // Timeout per test
  timeout: 30 * 1000,
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  // E2E specs share one synthetic DB user and the `seeded` fixture wipes
  // + re-seeds rows before each test. Running specs in parallel would cause
  // workers to clobber each other's data mid-test.
  workers: 1,
  // Reporter to use. See https://playwright.dev/docs/test-reporters
  reporter: process.env.CI ? 'github' : 'list',

  expect: {
    // Set timeout for async expect matchers
    timeout: 10 * 1000,
  },

  // The Go server with the SPA build, as in production. `npm run build`
  // must run with E2E_MOCK_AUTH=true first (the mock Clerk is swapped in
  // at build time); CI does that, locally `npm run test:e2e` reuses a
  // server that is already up.
  webServer: {
    // The root start script: the server binary with the client build.
    command: 'npm run start',
    cwd: path.resolve(__dirname, '../..'),
    url: baseURL,
    timeout: 2 * 60 * 1000,
    reuseExistingServer: !process.env.CI,
    // In CI the server's log goes into the job log next to the failures.
    stdout: process.env.CI ? 'pipe' : 'ignore',
    env: {
      PORT: String(PORT),
      // Mock auth on the server: every request is the e2e user.
      E2E_MOCK_AUTH: 'true',
      NEXT_PUBLIC_E2E_MOCK_AUTH: 'true',
      // Doctor verification uploads are stored on disk.
      FILES_STORAGE_PATH: E2E_FILES_STORAGE_PATH,
      // The Content-Security-Policy enforced, as production should run it:
      // every spec then fails if the app loads a script the policy blocks.
      CSP_ENFORCE: 'true',
    },
  },

  // Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions.
  use: {
    // Use baseURL so to make navigations relative.
    // More information: https://playwright.dev/docs/api/class-testoptions#test-options-base-url
    baseURL,

    // Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
    trace: process.env.CI ? 'retain-on-failure' : undefined,

    // Record videos when retrying the failed test.
    video: process.env.CI ? 'retain-on-failure' : undefined,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
          },
        ]
      : []),
  ],
});
