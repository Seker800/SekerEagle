import type { EagleAssetListItem, PhotoMetadata } from '../../lib/eagle-api';
import { getLocale } from '../../i18n';

type DatedAsset = Pick<EagleAssetListItem, 'chronologicalAt' | 'libraryAddedAt' | 'createdAt'> & {
  photoMetadata?: Pick<PhotoMetadata, 'capturedAt'> | null;
};

export function getPhotoTimelineMonth(asset: DatedAsset): string | undefined {
  const date = [
    asset.chronologicalAt,
    asset.photoMetadata?.capturedAt,
    asset.libraryAddedAt,
    asset.createdAt,
  ].find((value) => value && Number.isFinite(Date.parse(value)));
  return date ? new Date(date).toISOString().slice(0, 7) : undefined;
}

export function createPhotoTimelineSectionKeys(assets: readonly (DatedAsset & { id: string })[]) {
  return new Map(
    assets.flatMap((asset) => {
      const month = getPhotoTimelineMonth(asset);
      return month ? [[asset.id, month] as const] : [];
    }),
  );
}

export function formatPhotoTimelineMonth(month: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}
