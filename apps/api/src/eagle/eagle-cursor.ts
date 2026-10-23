import { BadRequestException } from '@nestjs/common';
import { defaultAssetSort, type EagleAssetSort } from './eagle-asset-order';
import type { LibraryIdentity } from './library-mode';

export interface EagleAssetCursor {
  direction?: 'NEWER';
  libraryAddedAt: Date;
  id: string;
}

export function encodeEagleAssetCursor(
  value: EagleAssetCursor,
  scope?: LibraryIdentity,
  sort?: EagleAssetSort,
  direction?: 'NEWER',
): string {
  if (direction && !scope) throw new BadRequestException('游标缺少图库作用域。');
  return Buffer.from(
    JSON.stringify({
      v: direction ? 5 : sort ? 4 : scope ? 3 : 2,
      ...(direction ? { direction, sort: sort ?? defaultAssetSort(scope!.libraryMode) } : {}),
      ...(sort ? { sort } : {}),
      ...(scope ?? {}),
      libraryAddedAt: value.libraryAddedAt.toISOString(),
      id: value.id,
    }),
  ).toString('base64url');
}

export function decodeEagleAssetCursor(
  value: string,
  scope?: LibraryIdentity,
  sort?: EagleAssetSort,
): EagleAssetCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      scope &&
      ([3, 4, 5].includes(Number(parsed.v))
        ? parsed.ownerId !== scope.ownerId || parsed.libraryMode !== scope.libraryMode
        : scope.libraryMode !== 'MATERIAL')
    )
      throw new Error('Cursor scope mismatch');
    if (parsed.v === 4 || parsed.v === 5) {
      if (!scope || parsed.sort !== (sort ?? defaultAssetSort(scope.libraryMode)))
        throw new Error('Cursor sort mismatch');
    } else if (scope && sort && sort !== defaultAssetSort(scope.libraryMode)) {
      throw new Error('Legacy cursor cannot change date field');
    }
    const rawTimestamp = parsed.v === 1 ? parsed.createdAt : parsed.libraryAddedAt;
    const libraryAddedAt = new Date(String(rawTimestamp));
    if (
      (parsed.v === 5 && parsed.direction !== 'NEWER') ||
      ![1, 2, 3, 4, 5].includes(Number(parsed.v)) ||
      !String(parsed.id).trim() ||
      Number.isNaN(libraryAddedAt.getTime())
    ) {
      throw new Error();
    }
    return {
      libraryAddedAt,
      id: String(parsed.id),
      ...(parsed.v === 5 ? { direction: 'NEWER' as const } : {}),
    };
  } catch {
    throw new BadRequestException('素材列表游标无效。');
  }
}
