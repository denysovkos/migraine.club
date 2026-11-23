// What the admin pages read from the database on the server, through the
// admin API: 401 sends the visitor to sign in (requireUserOrRedirect), 403 is
// the page's own Forbidden view.
import { redirect } from 'next/navigation';

import { getSignInPath } from '@/libs/AuthGuard';
import { AppConfig } from '@/utils/AppConfig';

export async function adminGet<T>(url: string): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    redirect(getSignInPath(AppConfig.defaultLocale));
  }
  if (!res.ok) {
    return { status: res.status, data: null };
  }
  return { status: res.status, data: (await res.json()) as T };
}
