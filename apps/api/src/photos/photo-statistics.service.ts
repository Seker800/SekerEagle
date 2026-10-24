import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PhotoStatisticsQueryDto } from './photo-statistics.dto';

type Grain = 'day' | 'week' | 'month' | 'year';
export function statisticsPeriods(first: string | null, last: string | null, grain: Grain) {
  if (!first || !last) return [];
  const date = new Date(`${first.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${last.slice(0, 10)}T00:00:00Z`);
  if (date > end) return [];
  if (grain === 'week') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  } else if (grain !== 'day') {
    date.setUTCDate(1);
    end.setUTCDate(1);
  }
  if (grain === 'year') {
    date.setUTCMonth(0);
    end.setUTCMonth(0);
  }
  const periods: string[] = [];
  while (date <= end) {
    const limit = grain === 'week' ? 10440 : 732;
    if (periods.length === limit)
      throw new BadRequestException(`统计最多显示 ${limit} 个时间段，请缩小日期范围或改用月／年。`);
    periods.push(
      date
        .toISOString()
        .slice(0, grain === 'day' || grain === 'week' ? 10 : grain === 'month' ? 7 : 4),
    );
    if (grain === 'day' || grain === 'week')
      date.setUTCDate(date.getUTCDate() + (grain === 'week' ? 7 : 1));
    else if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  return periods;
}
export interface Usage {
  key: string;
  count: number;
}
interface Summary {
  total: number;
  unknownDate: number;
  first: string | null;
  last: string | null;
  cameras: Usage[];
  lenses: Usage[];
  cameraOptions: string[];
  lensOptions: string[];
  points: Array<{ period: string; key: string | null; count: number }>;
}

/** Read-only photography analytics. One database statement gives all charts the same snapshot. */
@Injectable()
export class PhotoStatisticsService {
  constructor(private readonly prisma: PrismaService) {}
  async get(ownerId: string, includePrivate: boolean, query: PhotoStatisticsQueryDto) {
    const grain = query.grain ?? 'week';
    const groupBy = query.groupBy ?? 'camera';
    const dimension =
      groupBy === 'lens'
        ? Prisma.sql`lens`
        : groupBy === 'camera'
          ? Prisma.sql`camera`
          : Prisma.sql`''::text`;
    const period =
      grain === 'week'
        ? Prisma.sql`TO_CHAR(date_trunc('week', f.day::date::timestamp), 'YYYY-MM-DD')`
        : Prisma.sql`LEFT(f.day, ${grain === 'day' ? 10 : grain === 'month' ? 7 : 4}::int)`;
    if (query.start && query.end && query.start > query.end)
      throw new BadRequestException('开始日期不能晚于结束日期。');
    if (query.start && query.end) statisticsPeriods(query.start, query.end, grain);
    const [summary] = await this.prisma.$queryRaw<Summary[]>(Prisma.sql`
      WITH scoped AS MATERIALIZED (
        SELECT COALESCE(NULLIF(BTRIM(m."cameraModel"), ''), '') AS camera,
          COALESCE(NULLIF(BTRIM(m."lensModel"), ''), '') AS lens,
          CASE WHEN m."capturedAt" IS NULL THEN NULL
            WHEN m."capturedLocal" ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN LEFT(m."capturedLocal", 10)
            ELSE TO_CHAR(m."capturedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS day
        FROM "EagleAsset" a LEFT JOIN "EaglePhotoMetadata" m ON m."assetId" = a.id
          AND m."ownerId" = a."ownerId" AND m."libraryMode" = a."libraryMode"
          AND m."assetRevision" = a."mediaRevision"
        WHERE a."ownerId" = ${ownerId} AND a."libraryMode" = 'PHOTO' AND a."deletedAt" IS NULL
          AND a."mimeType" LIKE 'image/%'
          ${includePrivate ? Prisma.empty : Prisma.sql`AND a."isPrivate" = false`}
      ), filtered AS MATERIALIZED (
        SELECT * FROM scoped WHERE true
          ${query.cameras?.length ? Prisma.sql`AND camera IN (${Prisma.join(query.cameras)})` : Prisma.empty}
          ${query.lenses?.length ? Prisma.sql`AND lens IN (${Prisma.join(query.lenses)})` : Prisma.empty}
          ${query.start ? Prisma.sql`AND day >= ${query.start}` : Prisma.empty}
          ${query.end ? Prisma.sql`AND day <= ${query.end}` : Prisma.empty}
      ), camera_counts AS (SELECT camera AS key, count(*)::int AS count FROM filtered GROUP BY camera),
      lens_counts AS (SELECT lens AS key, count(*)::int AS count FROM filtered GROUP BY lens),
      dated AS (SELECT day, ${dimension} AS device FROM filtered WHERE day IS NOT NULL),
      ranked AS (
        SELECT device AS key, row_number() OVER (ORDER BY count(*) DESC, device) AS rank
        FROM dated GROUP BY device
      ), points AS (
        SELECT ${period} AS period,
          CASE WHEN r.rank <= 23 THEN f.device ELSE NULL END AS key, count(*)::int AS count
        FROM dated f JOIN ranked r ON r.key = f.device
        GROUP BY period, CASE WHEN r.rank <= 23 THEN f.device ELSE NULL END
      )
      SELECT count(*)::int AS total, count(*) FILTER (WHERE day IS NULL)::int AS "unknownDate",
        MIN(day) AS first, MAX(day) AS last,
        COALESCE((SELECT jsonb_agg(c ORDER BY count DESC, key) FROM camera_counts c), '[]') AS cameras,
        COALESCE((SELECT jsonb_agg(l ORDER BY count DESC, key) FROM lens_counts l), '[]') AS lenses,
        COALESCE((SELECT jsonb_agg(camera ORDER BY camera) FROM (SELECT DISTINCT camera FROM scoped) c), '[]') AS "cameraOptions",
        COALESCE((SELECT jsonb_agg(lens ORDER BY lens) FROM (SELECT DISTINCT lens FROM scoped) l), '[]') AS "lensOptions",
        COALESCE((SELECT jsonb_agg(p ORDER BY period, key) FROM points p), '[]') AS points
      FROM filtered
    `);
    return {
      ...summary!,
      grain,
      groupBy,
      periods: statisticsPeriods(query.start ?? summary!.first, query.end ?? summary!.last, grain),
    };
  }
}
