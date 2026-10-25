import type { EagleAssetRendition } from '@prisma/client';
import { assertOwnedObjectKey } from '../storage/object-key';

export interface TransferRendition {
  id: string;
  kind: 'THUMBNAIL' | 'PREVIEW' | 'POSTER';
  variant: string;
  sourceKey: string;
  targetKey: string;
  size: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}
export function planTransferRenditions(
  ownerId: string,
  targetId: string,
  revision: number,
  rows: EagleAssetRendition[],
): TransferRendition[] {
  return rows
    .filter(
      (r) =>
        r.revision === revision &&
        r.status === 'READY' &&
        ['THUMBNAIL', 'PREVIEW', 'POSTER'].includes(r.kind) &&
        ['image/webp', 'image/jpeg', 'image/png', 'video/mp4'].includes(r.mimeType),
    )
    .map((r) => {
      assertOwnedObjectKey(ownerId, r.storageKey);
      return {
        id: r.id,
        kind: r.kind,
        variant: r.variant,
        sourceKey: r.storageKey,
        targetKey: `users/${ownerId}/assets/${targetId}/transfer/${r.id}`,
        size: String(r.byteSize),
        mimeType: r.mimeType,
        width: r.width,
        height: r.height,
      };
    });
}
export function transferredBrowsingReady(rows: TransferRendition[]) {
  return [
    ['PREVIEW', 'default'],
    ['THUMBNAIL', '256'],
    ['THUMBNAIL', '512'],
  ].every(([kind, variant]) =>
    rows.some((r) => r.kind === kind && r.variant === variant && r.mimeType.startsWith('image/')),
  );
}
