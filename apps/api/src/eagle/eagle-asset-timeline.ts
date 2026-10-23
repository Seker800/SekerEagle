import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { LibraryIdentity } from './library-mode';
import { assetDateField, type EagleAssetSort } from './eagle-asset-order';

/** Unfiltered public library navigation; no asset IDs or private rows leave this aggregate. */
export async function readAssetTimeline(
  db: PrismaService,
  scope: LibraryIdentity,
  sort: EagleAssetSort | undefined,
  timeZone = 'UTC',
) {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
  } catch {
    throw new BadRequestException('时区无效。');
  }
  const column =
    assetDateField(scope.libraryMode, sort) === 'chronologicalAt'
      ? Prisma.sql`"chronologicalAt"`
      : Prisma.sql`"libraryAddedAt"`;
  const rows = await db.$queryRaw<Array<{ day: string; boundary: Date; count: bigint }>>(Prisma.sql`
    WITH days AS (
      SELECT date_trunc('day', (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}) AS day, count(*) AS count
      FROM "EagleAsset" WHERE "ownerId" = ${scope.ownerId} AND "libraryMode" = ${scope.libraryMode}::"LibraryMode"
        AND "deletedAt" IS NULL AND "isPrivate" = false GROUP BY 1
    )
    SELECT to_char(day, 'YYYY-MM-DD') AS day,
      ((day + interval '1 day') AT TIME ZONE ${timeZone}) AT TIME ZONE 'UTC' AS boundary, count
    FROM days ORDER BY day DESC
  `);
  let total = 0;
  const days = rows.map((row) => {
    const offset = total;
    total += Number(row.count);
    return { date: row.day, before: row.boundary.toISOString(), count: Number(row.count), offset };
  });
  return { days, total };
}
