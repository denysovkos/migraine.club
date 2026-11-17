import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { AllLocales, AppConfig } from '@/utils/AppConfig';

// Messages live in src/locales. en.json is the source of truth; fr.json and
// uk.json are kept in step by hand in the same PR that changes en.json.
// `node scripts/scan-i18n.mjs` reports missing keys.

// Using internationalization in Server Components
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(AllLocales, requested) ? requested : AppConfig.defaultLocale;

  return {
    locale,
    messages: (await import(`../locales/${locale}.json`)).default,
    timeZone: 'UTC',
  };
});
