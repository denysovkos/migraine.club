import { redirect } from 'next/navigation';

/**
 * Legacy user-profile route - redirects to the new Settings > Account page.
 * @deprecated Use /dashboard/settings/account instead.
 */
export default function UserProfileRedirectPage() {
  redirect('/dashboard/settings/account');
}
