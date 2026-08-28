import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/config/env';

const env = loadEnv();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: env.DATABASE_URL },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
