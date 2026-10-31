import { Prisma } from '@prisma/client';
import { COLOR_PROCESSOR_VERSION } from './eagle-color-search';

/** Shared database projection and public DTO serialization; no application-service dependency. */
export const publicPhotoMetadataSelect = Prisma.validator<Prisma.EaglePhotoMetadataSelect>()({
  capturedAt: true,
  capturedLocal: true,
  captureTimeZoneKnown: true,
  captureMetadataInherited: true,
  cameraMake: true,
  cameraModel: true,
  lensModel: true,
  focalLength: true,
  aperture: true,
  exposureSeconds: true,
  iso: true,
  latitude: true,
  longitude: true,
  altitude: true,
  sharpnessScore: true,
  perceptualHash: true,
});

export const publicPhotoLocationSelect = {
  assetRevision: true,
  cityId: true,
  name: true,
  country: true,
  region: true,
  latitude: true,
  longitude: true,
  source: true,
} satisfies Prisma.EaglePhotoLocationSelect;

export const assetListInclude = Prisma.validator<Prisma.EagleAssetInclude>()({
  photoMetadata: { select: publicPhotoMetadataSelect },
  photoLocation: { select: publicPhotoLocationSelect },
  renditions: {
    where: { status: 'READY' },
    orderBy: [{ revision: 'desc' }, { kind: 'asc' }],
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
  manualTagLinks: {
    orderBy: { tag: { normalizedName: 'asc' } },
    select: { tag: { select: { id: true, name: true, color: true } } },
  },
});

export const assetInclude = Prisma.validator<Prisma.EagleAssetInclude>()({
  ...assetListInclude,
  manualTagLinks: {
    select: { tag: { select: { id: true, name: true, color: true, marksAssetsPrivate: true } } },
  },
  photoFaces: {
    where: { isCurrent: true, person: { marksAssetsPrivate: true } },
    select: { assetRevision: true, person: { select: { id: true, name: true } } },
  },
  annotation: { select: { color: true, description: true, sourceUrl: true } },
  aiTagLinks: {
    where: { status: 'ACTIVE' },
    orderBy: { confidence: 'desc' },
    select: { confidence: true, status: true, aiTag: { select: { id: true, name: true } } },
  },
  colorAnalyses: {
    where: { isCurrent: true, processorVersion: COLOR_PROCESSOR_VERSION },
    take: 1,
    include: { swatches: { orderBy: { rank: 'asc' } } },
  },
});

export type AssetListRecord = Prisma.EagleAssetGetPayload<{ include: typeof assetListInclude }>;
export type AssetRecord = Prisma.EagleAssetGetPayload<{ include: typeof assetInclude }>;
export function serializeAsset(asset: AssetRecord) {
  const { annotation, aiTagLinks, colorAnalyses, photoFaces, ...listRecord } = asset;
  const privacyReasons = asset.isPrivate
    ? [
        ...asset.manualTagLinks
          .filter(({ tag }) => tag.marksAssetsPrivate)
          .map(({ tag }) => ({ kind: 'TAG' as const, id: tag.id, name: tag.name })),
        ...new Map(
          (photoFaces ?? [])
            .filter((face) => face.assetRevision === asset.mediaRevision && face.person)
            .map((face) => [
              face.person!.id,
              { kind: 'PERSON' as const, id: face.person!.id, name: face.person!.name },
            ]),
        ).values(),
      ]
    : [];
  return {
    ...serializeAssetList(listRecord),
    privacyReasons,
    annotation,
    aiTags: aiTagLinks.map(({ aiTag, confidence, status }) => ({ ...aiTag, confidence, status })),
    colorAnalysis: colorAnalyses[0]
      ? {
          assetRevision: colorAnalyses[0].assetRevision,
          processorVersion: colorAnalyses[0].processorVersion,
          status: colorAnalyses[0].status,
          lastError: colorAnalyses[0].lastError,
          completedAt: colorAnalyses[0].completedAt,
          swatches: colorAnalyses[0].swatches,
        }
      : null,
  };
}

export function serializeAssetList(asset: AssetListRecord) {
  const { manualTagLinks, ...record } = asset;
  const safe = {
    id: record.id,
    libraryMode: record.libraryMode,
    originalName: record.originalName,
    displayName: record.displayName,
    mimeType: record.mimeType,
    format: record.format,
    width: record.width,
    height: record.height,
    durationMs: record.durationMs,
    lifecycleStatus: record.lifecycleStatus,
    mediaErrorCode: record.mediaErrorCode,
    mediaRevision: record.mediaRevision,
    rowVersion: record.rowVersion,
    rating: record.rating,
    isPrivate: record.isPrivate,
    libraryAddedAt: record.libraryAddedAt,
    chronologicalAt: record.chronologicalAt,
    photoMetadata: record.photoMetadata,
    photoLocation:
      record.photoLocation?.assetRevision === record.mediaRevision ? record.photoLocation : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  };
  return {
    ...safe,
    byteSize: Number(asset.byteSize),
    originalUrl: `/api/${asset.libraryMode === 'PHOTO' ? 'photos' : 'eagle'}/assets/${asset.id}/original`,
    renditions: asset.renditions.map((rendition) => ({
      ...rendition,
      byteSize: Number(rendition.byteSize),
      url: `/api/${asset.libraryMode === 'PHOTO' ? 'photos' : 'eagle'}/assets/${asset.id}/renditions/${rendition.id}`,
    })),
    manualTags: manualTagLinks.map(({ tag }) => tag),
  };
}
