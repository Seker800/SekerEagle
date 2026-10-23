import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { MapViewportDto } from './photo-map.dto';
import { decodeMapCell, mapCursor, mapGrid, readMapCursor } from './photo-map-grid';
import { previewSelect, serializePreview } from './photo-preview';

/** Same current-version coordinate projection and grid for both counts and members. */
function locations(ownerId: string, includePrivate: boolean, n: number) {
  return Prisma.sql`
    WITH locations AS (
      SELECT a.id, a."chronologicalAt",
        CASE WHEN m.latitude BETWEEN -90 AND 90 AND m.longitude BETWEEN -180 AND 180
          THEN m.latitude ELSE l.latitude END AS latitude,
        CASE WHEN m.latitude BETWEEN -90 AND 90 AND m.longitude BETWEEN -180 AND 180
          THEN m.longitude ELSE l.longitude END AS longitude
      FROM "EagleAsset" a
      LEFT JOIN "EaglePhotoMetadata" m ON m."assetId" = a.id AND m."ownerId" = a."ownerId"
        AND m."libraryMode" = a."libraryMode" AND m."assetRevision" = a."mediaRevision"
      LEFT JOIN "EaglePhotoLocation" l ON l."assetId" = a.id AND l."ownerId" = a."ownerId"
        AND l."libraryMode" = a."libraryMode" AND l."assetRevision" = a."mediaRevision"
      WHERE a."ownerId" = ${ownerId} AND a."libraryMode" = 'PHOTO' AND a."deletedAt" IS NULL
        ${includePrivate ? Prisma.empty : Prisma.sql`AND a."isPrivate" = false`}
    ), valid AS (
      SELECT * FROM locations WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
    ), cells AS (
      SELECT *, LEAST(${n - 1}, GREATEST(0, FLOOR((longitude + 180) / 360 * ${n})))::int AS x,
        LEAST(${n - 1}, GREATEST(0, FLOOR((1 - LN(TAN(PI() / 4 +
          RADIANS(LEAST(85.05112878, GREATEST(-85.05112878, latitude))) / 2)) / PI()) / 2 * ${n})))::int AS y
      FROM valid
    )`;
}
interface ClusterRow {
  x: number;
  y: number;
  count: number;
  latitude: number;
  longitude: number;
}
interface SummaryRow {
  total: bigint;
  west: number | null;
  east: number | null;
  south: number | null;
  north: number | null;
  clusters: ClusterRow[];
}
@Injectable()
export class PhotoMapService {
  constructor(private readonly prisma: PrismaService) {}
  async clusters(ownerId: string, includePrivate: boolean, view: MapViewportDto) {
    const grid = mapGrid(view);
    const ranges = grid.xRanges.map(([min, max]) => Prisma.sql`x BETWEEN ${min} AND ${max}`);
    const [summary] = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      ${locations(ownerId, includePrivate, grid.n)}, grouped AS (
        SELECT x, y, count(*)::int AS count,
          DEGREES(ATAN(SINH(PI() * (1 - 2 * (y + 0.5) / ${grid.n})))) AS latitude,
          (x + 0.5) / ${grid.n} * 360 - 180 AS longitude
        FROM cells WHERE y BETWEEN ${grid.yMin} AND ${grid.yMax}
          AND (${Prisma.join(ranges, ' OR ')}) GROUP BY x, y
      ), summary AS (
        SELECT count(*) AS total, MIN(longitude) AS west, MAX(longitude) AS east,
          MIN(latitude) AS south, MAX(latitude) AS north FROM valid
      )
      SELECT summary.*, COALESCE((SELECT jsonb_agg(to_jsonb(grouped) ORDER BY x,y) FROM grouped), '[]'::jsonb) AS clusters
      FROM summary
    `);
    return {
      total: Number(summary!.total),
      bounds:
        summary!.total > 0
          ? {
              west: summary!.west!,
              east: summary!.east!,
              south: summary!.south!,
              north: summary!.north!,
            }
          : null,
      level: grid.level,
      clusters: summary!.clusters.map((cluster) => ({
        ...cluster,
        id: `${grid.level}/${cluster.x}/${cluster.y}`,
      })),
    };
  }
  async photos(ownerId: string, includePrivate: boolean, key: string, after?: string) {
    const cell = decodeMapCell(key),
      scope = { ownerId, includePrivate, cell: key };
    const cursor = after ? readMapCursor(after, scope) : null;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; at: Date }>>(Prisma.sql`
      ${locations(ownerId, includePrivate, cell.n)}
      SELECT id, "chronologicalAt" AS at FROM cells WHERE x = ${cell.x} AND y = ${cell.y}
        ${cursor ? Prisma.sql`AND ("chronologicalAt", id) < (${cursor.at}, ${cursor.id})` : Prisma.empty}
      ORDER BY "chronologicalAt" DESC, id DESC LIMIT 61
    `);
    const page = rows.slice(0, 60);
    const assets = await this.prisma.eagleAsset.findMany({
      where: {
        id: { in: page.map((row) => row.id) },
        ownerId,
        libraryMode: 'PHOTO',
        deletedAt: null,
        ...(!includePrivate ? { isPrivate: false } : {}),
      },
      select: previewSelect,
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return {
      items: page.flatMap((row) => {
        const asset = byId.get(row.id);
        return asset ? [serializePreview(asset)] : [];
      }),
      nextCursor: rows.length > 60 ? mapCursor(scope, page.at(-1)!) : null,
    };
  }
}
