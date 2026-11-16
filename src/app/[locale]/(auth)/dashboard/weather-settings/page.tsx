import { redirect } from 'next/navigation';

/**
 * Legacy weather-settings route - redirects to the new Settings > Location page.
 * @deprecated Use /dashboard/settings/location instead.
 */
export default function WeatherSettingsRedirectPage() {
  redirect('/dashboard/settings/location');
}
