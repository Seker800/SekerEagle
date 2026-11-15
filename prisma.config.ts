import { defineConfig } from 'prisma/config';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL ?? '' },
});

# Automated fix for issue #114: [Bug]: Windows 客户端地图页缩放后渲染进程内存暴涨至 8GB、界面卡死并最终崩溃
