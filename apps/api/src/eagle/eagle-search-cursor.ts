import { BadRequestException } from '@nestjs/common';
import type { ImageSearchPosition } from './eagle-image-search.service';
import type { LibraryIdentity } from './library-mode';

export function encodeImageSearchCursor(
  query: string,
  position: ImageSearchPosition,
  scope: LibraryIdentity,
): string {
  return `image:${Buffer.from(JSON.stringify({ version: 4, query, position, ...scope })).toString('base64url')}`;
}

export function decodeImageSearchCursor(
  cursor: string | undefined,
  query: string,
  scope: LibraryIdentity,
): ImageSearchPosition | undefined {
  if (!cursor) return undefined;
  if (!cursor.startsWith('image:')) throw new BadRequestException('搜索游标无效。');
  try {
    const payload = JSON.parse(Buffer.from(cursor.slice(6), 'base64url').toString('utf8')) as {
      version?: unknown;
      ownerId?: unknown;
      libraryMode?: unknown;
      query?: unknown;
      position?: Partial<ImageSearchPosition>;
    };
    if (
      payload.version !== 4 ||
      payload.ownerId !== scope.ownerId ||
      payload.libraryMode !== scope.libraryMode ||
      payload.query !== query ||
      !payload.position ||
      typeof payload.position.assetId !== 'string' ||
      !payload.position.assetId ||
      payload.position.assetId.length > 128 ||
      !Number.isInteger(payload.position.tier) ||
      !Number.isFinite(payload.position.similarity) ||
      typeof payload.position.libraryAddedAt !== 'string' ||
      !Number.isFinite(Date.parse(payload.position.libraryAddedAt))
    ) {
      throw new Error('invalid semantic cursor');
    }
    return payload.position as ImageSearchPosition;
  } catch {
    throw new BadRequestException('搜索游标无效。');
  }
}
