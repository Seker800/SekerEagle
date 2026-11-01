import { Prisma } from '@prisma/client';
import type { PhotoStatisticsQueryDto } from './photo-statistics.dto';

/** Canonical date/device expressions shared by the original query and resident facts. */
export function photoStatisticsFactFieldsSql() {
  return Prisma.sql`COALESCE(NULLIF(BTRIM(m."cameraModel"), ''), '') AS camera,
          COALESCE(NULLIF(BTRIM(m."lensModel"), ''), '') AS raw_lens,
          COALESCE(NULLIF(BTRIM(m."cameraModel"), ''), NULLIF(BTRIM(m."cameraMake"), ''), '') AS lens_device,
          CASE WHEN m."capturedAt" IS NULL THEN NULL
            WHEN m."capturedLocal" ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN LEFT(m."capturedLocal", 10)
            ELSE TO_CHAR(m."capturedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS day`;
}

export function photoStatisticsSql(
  ownerId: string,
  includePrivate: boolean,
  query: PhotoStatisticsQueryDto,
  dailySource?: Prisma.Sql,
): Prisma.Sql {
  const grain = query.grain ?? 'month';
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

  const daily =
    dailySource ??
    Prisma.sql`        SELECT ${photoStatisticsFactFieldsSql()}, count(*)::int AS n
        FROM "EagleAsset" a LEFT JOIN "EaglePhotoMetadata" m ON m."assetId" = a.id
          AND m."ownerId" = a."ownerId" AND m."libraryMode" = a."libraryMode"
          AND m."assetRevision" = a."mediaRevision"
        WHERE a."ownerId" = ${ownerId} AND a."libraryMode" = 'PHOTO' AND a."deletedAt" IS NULL
          AND a."mimeType" LIKE 'image/%'
          ${includePrivate ? Prisma.empty : Prisma.sql`AND a."isPrivate" = false`}
        GROUP BY 1,2,3,4
`;
  return Prisma.sql`
      WITH daily AS (
        ${daily}
      ), scoped AS MATERIALIZED (
        SELECT camera, raw_lens,
          CASE WHEN raw_lens <> '' THEN array_to_json(ARRAY['lens', raw_lens])::text
            WHEN lens_device <> '' THEN array_to_json(ARRAY['camera', lens_device])::text
            ELSE array_to_json(ARRAY['unknown', ''])::text END AS lens,
          day, n FROM daily
      ), filtered AS MATERIALIZED (
        SELECT * FROM scoped WHERE true
          ${query.cameras?.length ? Prisma.sql`AND camera IN (${Prisma.join(query.cameras)})` : Prisma.empty}
          ${query.lenses?.length ? Prisma.sql`AND raw_lens IN (${Prisma.join(query.lenses)})` : Prisma.empty}
          ${query.lensKeys?.length ? Prisma.sql`AND lens IN (${Prisma.join(query.lensKeys)})` : Prisma.empty}
          ${query.start ? Prisma.sql`AND day >= ${query.start}` : Prisma.empty}
          ${query.end ? Prisma.sql`AND day <= ${query.end}` : Prisma.empty}
      ), camera_counts AS (SELECT camera AS key, sum(n)::int AS count FROM filtered GROUP BY camera),
      lens_counts AS (SELECT lens AS key, sum(n)::int AS count FROM filtered GROUP BY lens),
      dated AS (SELECT day, n, ${dimension} AS device FROM filtered WHERE day IS NOT NULL),
      ranked AS (
        SELECT device AS key, row_number() OVER (ORDER BY sum(n) DESC, device) AS rank
        FROM dated GROUP BY device
      ), points AS (
        SELECT ${period} AS period,
          CASE WHEN r.rank <= 23 THEN f.device ELSE NULL END AS key, sum(f.n)::int AS count
        FROM dated f JOIN ranked r ON r.key = f.device
        GROUP BY period, CASE WHEN r.rank <= 23 THEN f.device ELSE NULL END
      )
      SELECT COALESCE(sum(n),0)::int AS total, COALESCE(sum(n) FILTER (WHERE day IS NULL),0)::int AS "unknownDate",
        MIN(day) AS first, MAX(day) AS last,
        COALESCE((SELECT jsonb_agg(c ORDER BY count DESC, key) FROM camera_counts c), '[]') AS cameras,
        COALESCE((SELECT jsonb_agg(l ORDER BY count DESC, key) FROM lens_counts l), '[]') AS lenses,
        COALESCE((SELECT jsonb_agg(camera ORDER BY camera) FROM (SELECT DISTINCT camera FROM scoped) c), '[]') AS "cameraOptions",
        COALESCE((SELECT jsonb_agg(lens ORDER BY lens) FROM (SELECT DISTINCT lens FROM scoped) l), '[]') AS "lensOptions",
        COALESCE((SELECT jsonb_agg(p ORDER BY period, key) FROM points p), '[]') AS points
      FROM filtered
    `;
}
