import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { backgroundScheduleAllows } from '../../packages/library-core/dist/index.js';
import { dailyWindowSql } from '../../packages/library-persistence/dist/background-schedule.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
const prisma = new PrismaClient();
after(() => prisma.$disconnect());

test('SQL rejects malformed equal windows just as the shared rule does', async () => {
  for (const value of ['', 'invalid', '24:00', '9:00', '12:60']) {
    const [row] = await prisma.$queryRaw`SELECT ${dailyWindowSql(Prisma.sql`${value}::text`, Prisma.sql`${value}::text`)} AS allowed`;
    assert.equal(row.allowed, backgroundScheduleAllows({ mode: 'NIGHT', nightStart: value, nightEnd: value }));
  }
});
