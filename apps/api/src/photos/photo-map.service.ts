import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { MapViewportDto } from './photo-map.dto';
import { decodeMapCell, mapCursor, mapGrid, readMapCursor } from './photo-map-grid';
import { previewSelect, serializePreview } from './photo-preview';

type MapSummary = {
  includePrivate: boolean;
  total: number;
  south: number | null;
  north: number | null;
  west: number | null;
  east: number | null;
};
const FEATURED_LOCATION_LIMIT = 9;
const emptyMap = (level: number, pending: boolean) => ({
  total: 0,
  bounds: null,
  level,
  clusters: [],
  status: pending ? 'PENDING' : 'READY',
  updatedAt: null,
  snapshotId: null,
  minimumPhotoCount: 0,
});

/** Read only persisted map generations. Opening a map never scans photography metadata. */
@Injectable()
export class PhotoMapService {
  constructor(private readonly prisma: PrismaService) {}
  async clusters(ownerId: string, includePrivate: boolean, view: MapViewportDto) {
    const requestedGrid = mapGrid(view);
    return this.prisma.$transaction(
      async (tx) => {
        const state = await tx.eaglePhotoMapState.findUnique({
          where: { ownerId_libraryMode: { ownerId, libraryMode: 'PHOTO' } },
        });
        if (!state) return emptyMap(requestedGrid.level, false);
        let snapshot = state.activeSnapshotId
          ? await tx.eaglePhotoMapSnapshot.findFirst({
              where: {
                ownerId,
                libraryMode: 'PHOTO',
                id: state.activeSnapshotId,
                visibilityVersion: state.visibilityVersion,
                completedAt: { not: null },
              },
            })
          : null;
        // nextLevel advances atomically with whole committed levels. Never treat an
        // unfinished finer level as empty or read points under an obsolete visibility version.
        if (
          state.buildingSnapshotId &&
          state.nextLevel > 0 &&
          (!snapshot || state.nextLevel > requestedGrid.level)
        ) {
          const building = await tx.eaglePhotoMapSnapshot.findFirst({
            where: {
              id: state.buildingSnapshotId,
              ownerId,
              libraryMode: 'PHOTO',
              visibilityVersion: state.visibilityVersion,
            },
          });
          if (building) snapshot = building;
        }
        if (!snapshot) return emptyMap(requestedGrid.level, true);
        const partial = snapshot.completedAt === null;
        const grid = partial ? mapGrid(view, Math.min(21, state.nextLevel - 1)) : requestedGrid;
        const summary = (snapshot.summary as unknown as MapSummary[]).find(
          (s) => s.includePrivate === includePrivate,
        )!;
        const cells = await tx.eaglePhotoMapCell.findMany({
          where: {
            ownerId,
            libraryMode: 'PHOTO',
            snapshotId: snapshot.id,
            includePrivate,
            level: grid.level,
            y: { gte: grid.yMin, lte: grid.yMax },
            OR: grid.xRanges.map(([min, max]) => ({ x: { gte: min, lte: max } })),
          },
          orderBy: [{ x: 'asc' }, { y: 'asc' }],
        });
        const ranked = cells
          .filter(
            (cell) =>
              cell.latitude >= view.south &&
              cell.latitude <= view.north &&
              (view.west <= view.east
                ? cell.longitude >= view.west && cell.longitude <= view.east
                : cell.longitude >= view.west || cell.longitude <= view.east),
          )
          .sort((a, b) => b.count - a.count || a.coverId.localeCompare(b.coverId));
        const candidates = ranked.slice(0, FEATURED_LOCATION_LIMIT);
        const assets = candidates.length
          ? await tx.eagleAsset.findMany({
              where: {
                ownerId,
                libraryMode: 'PHOTO',
                deletedAt: null,
                ...(!includePrivate ? { isPrivate: false } : {}),
                OR: candidates.map((cell) => ({
                  id: cell.coverId,
                  mediaRevision: cell.coverRevision,
                })),
              },
              select: { ...previewSelect, photoMetadata: false },
            })
          : [];
        const covers = new Map(
          assets.map((asset) => [asset.id, serializePreview({ ...asset, photoMetadata: null })]),
        );
        return {
          total: summary.total,
          bounds: summary.total
            ? {
                south: summary.south!,
                north: summary.north!,
                west: summary.west!,
                east: summary.east!,
              }
            : null,
          level: grid.level,
          status: partial || state.dirtyAt ? 'UPDATING' : 'READY',
          partial,
          updatedAt: (snapshot.completedAt ?? snapshot.createdAt).toISOString(),
          snapshotId: snapshot.id,
          minimumPhotoCount: 0,
          clusters: cells.map((cell) => ({
            id: `${snapshot.id}:${cell.level}/${cell.x}/${cell.y}`,
            x: cell.x,
            y: cell.y,
            count: cell.count,
            latitude: cell.latitude,
            longitude: cell.longitude,
            photoLatitude: cell.latitude,
            photoLongitude: cell.longitude,
            south: cell.south,
            north: cell.north,
            west: cell.west,
            east: cell.east,
            cover: covers.get(cell.coverId) ?? null,
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async photos(ownerId: string, includePrivate: boolean, key: string, after?: string) {
    const cell = decodeMapCell(key),
      scope = { ownerId, includePrivate, cell: key };
    const cursor = after ? readMapCursor(after, scope) : null;
    if (!cell.snapshotId) throw new NotFoundException('地图位置已更新，请重新选择地点。');
    return this.prisma.$transaction(
      async (tx) => {
        const state = await tx.eaglePhotoMapState.findUnique({
          where: { ownerId_libraryMode: { ownerId, libraryMode: 'PHOTO' } },
        });
        const snapshot = state
          ? await tx.eaglePhotoMapSnapshot.findFirst({
              where: {
                ownerId,
                libraryMode: 'PHOTO',
                id: cell.snapshotId,
                visibilityVersion: state.visibilityVersion,
                OR: [
                  { completedAt: { not: null } },
                  ...(state.buildingSnapshotId === cell.snapshotId && cell.level < state.nextLevel
                    ? [{ id: state.buildingSnapshotId }]
                    : []),
                ],
              },
            })
          : null;
        if (!snapshot) throw new NotFoundException('地图位置已更新，请重新选择地点。');
        const scale = 2 ** (21 - cell.level);
        const rows = await tx.$queryRaw<Array<{ id: string; at: Date }>>(Prisma.sql`
        SELECT p."assetId" AS id,p."chronologicalAt" AS at FROM "EaglePhotoMapPoint" p
        JOIN "EagleAsset" a ON a.id=p."assetId" AND a."ownerId"=p."ownerId" AND a."libraryMode"=p."libraryMode" AND a."mediaRevision"=p."assetRevision"
        WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO' AND p."snapshotId"=${snapshot.id}
          AND p.x BETWEEN ${cell.x * scale} AND ${(cell.x + 1) * scale - 1}
          AND p.y BETWEEN ${cell.y * scale} AND ${(cell.y + 1) * scale - 1}
          AND a."deletedAt" IS NULL
          ${includePrivate ? Prisma.empty : Prisma.sql`AND p."isPrivate"=false AND a."isPrivate"=false`}
          ${cursor ? Prisma.sql`AND (p."chronologicalAt",p."assetId")<(${cursor.at},${cursor.id})` : Prisma.empty}
        ORDER BY p."chronologicalAt" DESC,p."assetId" DESC LIMIT 61
      `);
        const page = rows.slice(0, 60);
        const assets = await tx.eagleAsset.findMany({
          where: {
            ownerId,
            libraryMode: 'PHOTO',
            id: { in: page.map((row) => row.id) },
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
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
