import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // The Go server embeds the migrations.
  out: '../../apps/server/migrations',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
