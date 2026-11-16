import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const Env = createEnv({
  server: {
    CLERK_SECRET_KEY: z.string().min(1),
    DATABASE_URL: z.string().optional(),
    // Postgres pool size; cron jobs and web requests share this pool
    DATABASE_POOL_MAX: z.coerce.number().optional(),
    // Set to 'false' to skip the boot-time migration (run migrations in the deploy step instead)
    RUN_MIGRATIONS_ON_BOOT: z.string().optional(),
    LOGTAIL_SOURCE_TOKEN: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    BILLING_PLAN_ENV: z.enum(['dev', 'test', 'prod']),
    // Weather & Solar APIs
    OPENWEATHERMAP_API_KEY: z.string().optional(),
    // Per-request timeout for OpenWeatherMap calls (axios defaults to no timeout,
    // which lets a stalled upstream hang a cron run forever)
    OPENWEATHERMAP_TIMEOUT_MS: z.coerce.number().optional(),
    // NOAA endpoints are public, no key required
    // VAPID keys for Web Push notifications
    // Generate with: npx web-push generate-vapid-keys
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(), // mailto:email@example.com or https://example.com
    // Cron job authentication secret
    // Generate with: openssl rand -base64 32
    CRON_SECRET: z.string().optional(),
    // Feature flags
    ENABLE_F39_INSIGHTS: z.coerce.boolean().optional(),
    ENABLE_STALE_EPISODE_REMINDER: z.coerce.boolean().optional(),
    // Render mounted disk path for storing uploaded doctor verification documents (Feature F13)
    FILES_STORAGE_PATH: z.string().optional(),
    // E2E mock-auth bypass (local dev only — never set in production)
    E2E_MOCK_AUTH: z.string().optional(),
    E2E_MOCK_USER_ID: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().min(1),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
    // VAPID public key for Web Push - must be available on client
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
    // E2E mock-auth client-side flag (local dev only)
    NEXT_PUBLIC_E2E_MOCK_AUTH: z.string().optional(),
  },
  shared: {
    NODE_ENV: z.enum(['test', 'development', 'production']).optional(),
  },
  // You need to destructure all the keys manually
  runtimeEnv: {
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    RUN_MIGRATIONS_ON_BOOT: process.env.RUN_MIGRATIONS_ON_BOOT,
    LOGTAIL_SOURCE_TOKEN: process.env.LOGTAIL_SOURCE_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    BILLING_PLAN_ENV: process.env.BILLING_PLAN_ENV,
    OPENWEATHERMAP_API_KEY: process.env.OPENWEATHERMAP_API_KEY,
    OPENWEATHERMAP_TIMEOUT_MS: process.env.OPENWEATHERMAP_TIMEOUT_MS,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    CRON_SECRET: process.env.CRON_SECRET,
    ENABLE_F39_INSIGHTS: process.env.ENABLE_F39_INSIGHTS,
    ENABLE_STALE_EPISODE_REMINDER: process.env.ENABLE_STALE_EPISODE_REMINDER,
    FILES_STORAGE_PATH: process.env.FILES_STORAGE_PATH,
    E2E_MOCK_AUTH: process.env.E2E_MOCK_AUTH,
    E2E_MOCK_USER_ID: process.env.E2E_MOCK_USER_ID,
    NEXT_PUBLIC_E2E_MOCK_AUTH: process.env.NEXT_PUBLIC_E2E_MOCK_AUTH,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NODE_ENV: process.env.NODE_ENV,
  },
});
