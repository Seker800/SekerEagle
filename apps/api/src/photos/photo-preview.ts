import type { Prisma } from '@prisma/client';

export const previewSelect = {
  id: true,
  displayName: true,
  libraryMode: true,
  originalName: true,
  mimeType: true,
  format: true,
  mediaRevision: true,
  libraryAddedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  lifecycleStatus: true,
  mediaErrorCode: true,
  rowVersion: true,
  rating: true,
  width: true,
  height: true,
  durationMs: true,
  byteSize: true,
  renditions: {
    where: { status: 'READY' as const },
    select: {
      id: true,
      kind: true,
      variant: true,
      revision: true,
      mimeType: true,
      byteSize: true,
      width: true,
      height: true,
    },
  },
  photoMetadata: true,
} satisfies Prisma.EagleAssetSelect;
/** Person cards need browser media, not the complete EXIF record. */
export const facePreviewSelect = {
  ...previewSelect,
  photoMetadata: false,
  renditions: {
    ...previewSelect.renditions,
    where: {
      status: 'READY' as const,
      kind: { in: ['THUMBNAIL', 'PREVIEW', 'POSTER'] as Array<'THUMBNAIL' | 'PREVIEW' | 'POSTER'> },
    },
  },
} satisfies Prisma.EagleAssetSelect;
export const serializePreview = <
  T extends Pick<
    Prisma.EagleAssetGetPayload<{ select: typeof previewSelect }>,
    'byteSize' | 'renditions'
  >,
>(
  asset: T,
) => ({
  ...asset,
  byteSize: Number(asset.byteSize),
  renditions: asset.renditions.map((row) => ({ ...row, byteSize: Number(row.byteSize) })),
  manualTags: [],
});
