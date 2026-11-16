/**
 * Mock-auth helpers for Playwright e2e tests.
 *
 * When `E2E_MOCK_AUTH=true`, the app bypasses Clerk and treats requests as
 * authenticated for a fixed synthetic user. NEVER set this in production.
 *
 * Uses raw `process.env` (not the validated `Env` object) because middleware
 * runs in the Edge runtime where importing `Env` is fragile.
 */

export const E2E_MOCK_USER_ID_DEFAULT = 'e2e_user_test_001';

export const isE2EMockAuth = (): boolean =>
  process.env.E2E_MOCK_AUTH === 'true';

export const getE2EMockUserId = (): string =>
  process.env.E2E_MOCK_USER_ID || E2E_MOCK_USER_ID_DEFAULT;

export const E2E_MOCK_USER_EMAIL = 'e2e@test.local';
export const E2E_MOCK_USER_FIRST_NAME = 'E2E';
export const E2E_MOCK_USER_LAST_NAME = 'User';
