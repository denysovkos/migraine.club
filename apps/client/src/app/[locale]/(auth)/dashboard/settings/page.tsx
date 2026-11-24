import { redirect } from 'next/navigation';

/**
 * Settings index page - redirects to the Profile settings by default.
 */
export default function SettingsPage() {
  redirect('/dashboard/settings/profile');
}
