import { BadRequestException } from '@nestjs/common';

export interface EagleAssetCursor {
  libraryAddedAt: Date;
  id: string;
}

export function encodeEagleAssetCursor(value: EagleAssetCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 2, libraryAddedAt: value.libraryAddedAt.toISOString(), id: value.id }),
  ).toString('base64url');
}

export function decodeEagleAssetCursor(value: string): EagleAssetCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const rawTimestamp = parsed.v === 1 ? parsed.createdAt : parsed.libraryAddedAt;
    const libraryAddedAt = new Date(String(rawTimestamp));
    if (
      ![1, 2].includes(Number(parsed.v)) ||
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
