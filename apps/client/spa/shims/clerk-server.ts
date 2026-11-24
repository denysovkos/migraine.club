// @clerk/nextjs/server in the SPA. Pages only ask whether someone is signed
// in, to redirect; Clerk's cookies answer that (the API still verifies every
// request). __client_uat is 0 when signed out; __session's subject is the
// user id.
function cookie(name: string): string | undefined {
  return document.cookie.split('; ').find(c => c.startsWith(`${name}=`))?.slice(name.length + 1);
}

function sessionUserId(): string | null {
  const uat = Number(cookie('__client_uat') ?? '0');
  const session = cookie('__session');
  if (!uat || !session) {
    return null;
  }
  try {
    const payload = JSON.parse(atob(session.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function auth() {
  const userId = sessionUserId();
  return { userId, sessionId: null, orgId: null, has: () => false, getToken: async () => null };
}

export async function currentUser() {
  return null;
}
