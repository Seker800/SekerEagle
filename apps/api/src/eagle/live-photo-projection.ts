import type { LibraryMode, PrismaClient } from '@prisma/client';
interface Source {
  id: string;
  mediaRevision: number;
  livePhotoIdentifier?: string | null;
  livePhotoRole?: string | null;
}
export interface LivePhotoMotion {
  assetId: string;
  renditionId: string;
  revision: number;
}
/** Pair only a unique current still/movie, and authorize both resources independently. */
export async function resolveLivePhotoMotions(
  db: Pick<PrismaClient, 'eagleAsset'>,
  scope: { ownerId: string; libraryMode: LibraryMode },
  assets: Source[],
  includePrivate: boolean,
  trash = false,
) {
  const ids = [
    ...new Set(
      assets
        .filter((asset) => asset.livePhotoRole === 'STILL' && asset.livePhotoIdentifier)
        .map((asset) => asset.livePhotoIdentifier!),
    ),
  ];
  const result = new Map<string, LivePhotoMotion>();
  if (!ids.length) return result;
  const where = {
    ...scope,
    deletedAt: trash ? { not: null } : null,
    purgeAfter: trash ? null : undefined,
    lifecycleStatus: 'READY' as const,
    livePhotoIdentifier: { in: ids },
    livePhotoRole: { in: ['STILL', 'MOTION'] },
    ...(includePrivate ? {} : { isPrivate: false }),
  };
  const counts = await db.eagleAsset.groupBy({
    by: ['livePhotoIdentifier', 'livePhotoRole'],
    where,
    _count: { id: true },
  });
  const unique = ids.filter((id) =>
    ['STILL', 'MOTION'].every(
      (role) =>
        counts.find((row) => row.livePhotoIdentifier === id && row.livePhotoRole === role)?._count
          .id === 1,
    ),
  );
  if (!unique.length) return result;
  const candidates = await db.eagleAsset.findMany({
    where: { ...where, livePhotoIdentifier: { in: unique } },
    select: {
      id: true,
      livePhotoIdentifier: true,
      livePhotoRole: true,
      mediaRevision: true,
      renditions: {
        where: { status: 'READY', kind: 'PREVIEW', mimeType: 'video/mp4' },
        select: { id: true, revision: true },
      },
    },
  });
  for (const source of assets) {
    if (!unique.includes(source.livePhotoIdentifier ?? '')) continue;
    const stills = candidates.filter(
      (row) =>
        row.livePhotoIdentifier === source.livePhotoIdentifier && row.livePhotoRole === 'STILL',
    );
    const movies = candidates.filter(
      (row) =>
        row.livePhotoIdentifier === source.livePhotoIdentifier && row.livePhotoRole === 'MOTION',
    );
    if (
      stills.length !== 1 ||
      stills[0]!.id !== source.id ||
      stills[0]!.mediaRevision !== source.mediaRevision ||
      movies.length !== 1
    )
      continue;
    const movie = movies[0]!;
    const preview = movie.renditions.find((row) => row.revision === movie.mediaRevision);
    if (preview)
      result.set(source.id, {
        assetId: movie.id,
        renditionId: preview.id,
        revision: movie.mediaRevision,
      });
  }
  return result;
}
