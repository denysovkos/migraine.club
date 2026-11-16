import { cleanup } from '@testing-library/react';

import failOnConsole from 'vitest-fail-on-console';
import '@testing-library/jest-dom/vitest';

failOnConsole({
  shouldFailOnDebug: true,
  shouldFailOnError: true,
  shouldFailOnInfo: true,
  shouldFailOnLog: true,
  shouldFailOnWarn: true,
});

// Ensure no DOM leaks between tests across files.
afterEach(() => {
  cleanup();
});

// Set up environment variables for testing
process.env.BILLING_PLAN_ENV = 'test';

// Minimal required env vars for src/libs/Env.ts validation during unit tests.
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? 'test_clerk_secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'test_stripe_secret';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'test_stripe_webhook_secret';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? 'test_clerk_pk';
process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? '/sign-in';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? 'test_stripe_pk';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;
