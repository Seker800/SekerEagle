import { BadRequestException } from '@nestjs/common';
import type { LibraryIdentity } from './library-mode';

export interface EagleAssetCursor {
  libraryAddedAt: Date;
  id: string;
}

export function encodeEagleAssetCursor(value: EagleAssetCursor, scope?: LibraryIdentity): string {
  return Buffer.from(
    JSON.stringify({
      v: scope ? 3 : 2,
      ...(scope ?? {}),
      libraryAddedAt: value.libraryAddedAt.toISOString(),
      id: value.id,
    }),
  ).toString('base64url');
}

export function decodeEagleAssetCursor(value: string, scope?: LibraryIdentity): EagleAssetCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      scope &&
      (parsed.v === 3
        ? parsed.ownerId !== scope.ownerId || parsed.libraryMode !== scope.libraryMode
        : scope.libraryMode !== 'MATERIAL')
    )
      throw new Error('Cursor scope mismatch');
    const rawTimestamp = parsed.v === 1 ? parsed.createdAt : parsed.libraryAddedAt;
    const libraryAddedAt = new Date(String(rawTimestamp));
    if (
      ![1, 2, 3].includes(Number(parsed.v)) ||
      !String(parsed.id).trim() ||
      Number.isNaN(libraryAddedAt.getTime())
    ) {
      throw new Error();
    }
    return { libraryAddedAt, id: String(parsed.id) };
  } catch {
    throw new BadRequestException('素材列表游标无效。');
  }
}
