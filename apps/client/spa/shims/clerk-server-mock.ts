// @clerk/nextjs/server under E2E mock auth: every request is the e2e user,
// as src/libs/MockClerkServer.ts answered.
import { E2E_MOCK_USER_ID_DEFAULT } from '@/libs/E2EAuth';

export async function auth() {
  return {
    userId: import.meta.env.VITE_E2E_MOCK_USER_ID || E2E_MOCK_USER_ID_DEFAULT,
    sessionId: 'e2e_session_001',
    orgId: null,
    has: () => true,
    getToken: async () => 'e2e_token',
  };
}

export async function currentUser() {
  return null;
}
