import type { MetadataRoute } from 'next';

import { getBaseUrl } from '@/utils/Helpers';

export default function robots(): MetadataRoute.Robots {
  return {
    host: getBaseUrl(),
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Keep private/internal surfaces out of search.
        disallow: [
          '/api/',
          '/dashboard',
          '/admin',
          '/monitoring',
          '/share/',
        ],
      },
    ],
    sitemap: `${getBaseUrl()}/sitemap.xml`,
  };
}
