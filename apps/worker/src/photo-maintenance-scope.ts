import type { EagleAsset, EaglePhotoMetadata } from '@prisma/client';
export type RefreshItem = { assetId: string; sha256: string; mediaRevision: number };
export type PhotoMaintenanceCandidate = Pick<
  EagleAsset,
  'id' | 'ownerId' | 'libraryMode' | 'sha256' | 'mediaRevision' | 'deletedAt'
> & {
  photoMetadata: Pick<EaglePhotoMetadata, 'captureMetadataInherited'> | null;
};

export function validatePhotoMaintenanceManifest(input: unknown): RefreshItem[] {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw new Error('Expected 1–100 exact photo revisions');
  const ids = new Set<string>();
  const values: unknown[] = input;
  const result: RefreshItem[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') throw new Error('Invalid photo revision');
    const item = value as Record<string, unknown>;
    const { assetId, sha256, mediaRevision } = item;
    if (
      Object.keys(item).sort().join(',') !== 'assetId,mediaRevision,sha256' ||
      typeof assetId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(assetId) ||
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      typeof mediaRevision !== 'number' ||
      !Number.isSafeInteger(mediaRevision) ||
      mediaRevision < 0 ||
      ids.has(assetId)
    )
      throw new Error('Invalid or repeated photo revision');
    ids.add(assetId);
    result.push({ assetId, sha256, mediaRevision });
  }
  return result;
}

export function assertPhotoMaintenanceCandidates(
  manifest: RefreshItem[],
  assets: PhotoMaintenanceCandidate[],
): void {
  if (assets.length !== manifest.length || new Set(assets.map((asset) => asset.ownerId)).size !== 1)
    throw new Error('Photo refresh scope does not match');
  for (const item of manifest) {
    const asset = assets.find((value) => value.id === item.assetId);
    if (
      !asset ||
      asset.libraryMode !== 'PHOTO' ||
      asset.deletedAt ||
      asset.sha256 !== item.sha256 ||
      asset.mediaRevision !== item.mediaRevision ||
      asset.photoMetadata?.captureMetadataInherited
    )
      throw new Error('Photo refresh source changed or contains inherited capture data');
  }
}
