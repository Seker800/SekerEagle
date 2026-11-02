import { defineConfig } from 'prisma/config';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
