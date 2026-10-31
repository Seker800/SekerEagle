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
    const [row] =
      await prisma.$queryRaw`SELECT ${dailyWindowSql(Prisma.sql`${value}::text`, Prisma.sql`${value}::text`)} AS allowed`;
    assert.equal(
      row.allowed,
      backgroundScheduleAllows({ mode: 'NIGHT', nightStart: value, nightEnd: value }),
    );
  }
});

test('SQL and JS agree at Shanghai boundaries, midnight and equal endpoints', async () => {
  const windows = [
    ['23:00', '06:00'],
    ['09:00', '18:00'],
    ['00:00', '00:00'],
    ['12:34', '12:34'],
    ['invalid', '06:00'],
    ['23:00', '99:99'],
  ];
  const times = [
    '00:00',
    '05:59',
    '06:00',
    '08:59',
    '09:00',
    '12:34',
    '17:59',
    '18:00',
    '22:59',
    '23:00',
    '23:59',
  ];
  for (const [nightStart, nightEnd] of windows) {
    for (const time of times) {
      const now = new Date(`2026-11-01T${time}:00+08:00`);
      const [row] =
        await prisma.$queryRaw`SELECT ${dailyWindowSql(Prisma.sql`${nightStart}::text`, Prisma.sql`${nightEnd}::text`, Prisma.sql`${now}::timestamptz`)} AS allowed`;
      assert.equal(
        row.allowed,
        backgroundScheduleAllows({ mode: 'NIGHT', nightStart, nightEnd }, now),
        `${nightStart}–${nightEnd} at ${time}`,
      );
    }
  }
});
