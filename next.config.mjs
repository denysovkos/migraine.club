import path from 'node:path';
import { fileURLToPath } from 'node:url';

import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs/config';
import { createJiti } from 'jiti';
import withNextIntl from 'next-intl/plugin';

const jiti = createJiti(fileURLToPath(import.meta.url));

await jiti.import('./src/libs/Env');

const withNextIntlConfig = withNextIntl('./src/libs/i18n.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isE2EMockAuth = process.env.E2E_MOCK_AUTH === 'true';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
export default withSentryConfig(
  bundleAnalyzer(
    withNextIntlConfig({
      poweredByHeader: false,
      reactStrictMode: true,
      async redirects() {
        return [
          // The MCP setup guide moved to /mcp, which matches the nav label and
          // is what people actually search for.
          {
            source: '/help/ai-connector',
            destination: '/mcp',
            permanent: true,
          },
          {
            source: '/:locale/help/ai-connector',
            destination: '/:locale/mcp',
            permanent: true,
          },
        ];
      },
      serverExternalPackages: ['@electric-sql/pglite'],
      ...(isE2EMockAuth
        ? {
            // Turbopack alias (Next 16 default dev/build bundler).
            // Turbopack requires relative paths here — absolute paths get
            // treated as server-relative and break with "server relative
            // imports are not implemented yet".
            turbopack: {
              resolveAlias: {
                '@clerk/nextjs': './src/libs/MockClerk.tsx',
                '@clerk/nextjs/server': './src/libs/MockClerkServer.ts',
              },
            },
            // Webpack alias (only used if --turbo is disabled)
            webpack: (config) => {
              config.resolve = config.resolve || {};
              config.resolve.alias = {
                ...(config.resolve.alias || {}),
                '@clerk/nextjs$': path.resolve(__dirname, 'src/libs/MockClerk.tsx'),
                '@clerk/nextjs/server$': path.resolve(
                  __dirname,
                  'src/libs/MockClerkServer.ts',
                ),
              };
              return config;
            },
          }
        : {}),
      async rewrites() {
        return [
          {
            source: '/umami/script.js',
            destination: 'https://cloud.umami.is/script.js',
          },
        ];
      },
    }),
  ),
  {
    // For all available options, see:
    // https://github.com/getsentry/sentry-webpack-plugin#options
    // FIXME: Add your Sentry organization and project names
    org: 'nextjs-boilerplate-org',
    project: 'nextjs-boilerplate',

    // Only print logs for uploading source maps in CI
    silent: !process.env.CI,

    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    // This can increase your server load as well as your hosting bill.
    // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
    // side errors will fail.
    tunnelRoute: '/monitoring',

    // Disable Sentry telemetry
    telemetry: false,

    // Tree-shake Sentry SDK debug logger statements to reduce bundle size.
    // Works for both webpack and Turbopack builds.
    bundleSizeOptimizations: {
      excludeDebugStatements: true,
    },
  },
);
