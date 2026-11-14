import { isCameraRawMime } from '@sekereagle/library-core';

export interface StackCoverMember {
  assetId: string;
  asset: {
    createdAt: Date;
    lifecycleStatus: string;
    mimeType: string;
    photoMetadata?: { captureMetadataInherited: boolean } | null;
  };
}

/**
 * User-selected covers win. Otherwise a READY non-RAW member represents the
 * group so the gallery shows the camera-rendered JPEG instead of a neutral RAW
 * development; sharpness only ranks members within the same format class.
 */
export function selectPhotoStackCover(
  members: readonly StackCoverMember[],
  bestAssetId: string | null,
  bestSelectedByUser: boolean,
): StackCoverMember | undefined {
  const ready = members.filter(({ asset }) => asset.lifecycleStatus === 'READY');
  const stored = ready.find(({ assetId }) => assetId === bestAssetId);
  const nonRaw = ready.filter(({ asset }) => !isCameraRawMime(asset.mimeType));
  const newestInherited = (rows: readonly StackCoverMember[]) =>
    rows
      .filter(({ asset }) => asset.photoMetadata?.captureMetadataInherited)
      .reduce<StackCoverMember | undefined>(
        (newest, row) => (!newest || row.asset.createdAt > newest.asset.createdAt ? row : newest),
        undefined,
      );
  if (bestSelectedByUser && stored) return stored;
  if (stored && (!isCameraRawMime(stored.asset.mimeType) || nonRaw.length === 0)) return stored;
  return (
    newestInherited(nonRaw) ??
    nonRaw[0] ??
    stored ??
    newestInherited(ready) ??
    ready[0] ??
    members[0]
  );
}
