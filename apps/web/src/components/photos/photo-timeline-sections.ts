import type { EagleAssetListItem, EagleAssetSort, PhotoMetadata } from '../../lib/eagle-api';
import { getLocale } from '../../i18n';

type DatedAsset = Pick<EagleAssetListItem, 'chronologicalAt' | 'libraryAddedAt' | 'createdAt'> & {
  photoMetadata?: Pick<PhotoMetadata, 'capturedAt'> | null;
};

export function getPhotoTimelineDay(
  asset: DatedAsset,
  sort: EagleAssetSort = 'CAPTURED_AT',
): string | undefined {
  const candidates =
    sort === 'ADDED_AT'
      ? [asset.libraryAddedAt, asset.createdAt]
      : [
          asset.chronologicalAt,
          asset.photoMetadata?.capturedAt,
          asset.libraryAddedAt,
          asset.createdAt,
        ];
  const date = candidates.find((value) => value && Number.isFinite(Date.parse(value)));
  return date ? new Date(date).toISOString().slice(0, 10) : undefined;
}

export function createPhotoTimelineSectionKeys(
  assets: readonly (DatedAsset & { id: string })[],
  sort: EagleAssetSort = 'CAPTURED_AT',
) {
  return new Map(
    assets.flatMap((asset) => {
      const month = getPhotoTimelineMonth(asset, sort);
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

export function getPhotoTimelineMonth(
  asset: DatedAsset,
  sort: EagleAssetSort = 'CAPTURED_AT',
): string | undefined {
  return getPhotoTimelineDay(asset, sort)?.slice(0, 7);
}
export function createPhotoTimelineDayKeys(
  assets: readonly (DatedAsset & { id: string })[],
  sort: EagleAssetSort = 'CAPTURED_AT',
) {
  return new Map(
    assets.flatMap((asset) => {
      const day = getPhotoTimelineDay(asset, sort);
      return day ? [[asset.id, day] as const] : [];
    }),
  );
}
export function formatPhotoTimelineDay(day: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
