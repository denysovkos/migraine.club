import type { MetadataRoute } from 'next';

import { AllLocales } from '@/utils/AppConfig';
import { getBaseUrl } from '@/utils/Helpers';
import { getLocalizedPathname } from '@/utils/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();
  const now = new Date();

  // Public, indexable routes only (exclude auth/dashboard/admin/api/share token pages)
  const publicPathnames = [
    '/',
    '/product',
    '/community',
    '/help/install-notifications',
    '/mcp',
    '/privacy',
    '/terms',
  ] as const;

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of AllLocales) {
    for (const pathname of publicPathnames) {
      const localized = getLocalizedPathname(locale, pathname);
      const url = `${baseUrl}${localized === '/' ? '' : localized}`;

      const priority
        = pathname === '/'
          ? 1.0
          : pathname === '/product'
            ? 0.9
            : pathname === '/community' || pathname === '/mcp'
              ? 0.8
              : 0.6;

      entries.push({
        url,
        lastModified: now,
        changeFrequency: 'weekly',
        priority,
      });
    }
  }

  return entries;
}
