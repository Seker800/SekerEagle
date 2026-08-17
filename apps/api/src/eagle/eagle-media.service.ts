import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnedObjectKey } from '../storage/object-key';
import { ObjectStorageService } from '../storage/object-storage.service';

@Injectable()
export class EagleMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  async getOriginal(ownerId: string, assetId: string, range?: string, ifNoneMatch?: string) {
    const asset = await this.prisma.eagleAsset.findFirst({
      where: { ownerId, id: assetId, purgeAfter: null },
      select: { originalObjectKey: true, originalName: true, mimeType: true, byteSize: true },
    });
    if (!asset) throw new NotFoundException('素材不存在。');
    return this.open(ownerId, asset.originalObjectKey, asset.originalName, asset.mimeType, {
      range,
      ifNoneMatch,
      fullSize: asset.byteSize,
    });
  }

  async getOriginalMetadata(ownerId: string, assetId: string) {
    const asset = await this.prisma.eagleAsset.findFirst({
      where: { ownerId, id: assetId, purgeAfter: null },
      select: { byteSize: true },
    });
    if (!asset) throw new NotFoundException('素材不存在。');
    return { size: asset.byteSize };
  }

  async getRendition(ownerId: string, assetId: string, renditionId: string, ifNoneMatch?: string) {
    const rendition = await this.prisma.eagleAssetRendition.findFirst({
      where: { ownerId, assetId, id: renditionId, status: 'READY', asset: { purgeAfter: null } },
      select: { storageKey: true, mimeType: true, kind: true },
    });
    if (!rendition) throw new NotFoundException('预览文件不存在。');
    return this.open(
      ownerId,
      rendition.storageKey,
      `${rendition.kind.toLowerCase()}.webp`,
      rendition.mimeType,
      { ifNoneMatch },
    );
  }

  private async open(
    ownerId: string,
    key: string,
    fileName: string,
    fallbackMimeType: string,
    options?: { range?: string; ifNoneMatch?: string; fullSize?: bigint },
  ): Promise<OpenedEagleMedia> {
    assertOwnedObjectKey(ownerId, key);
    let object;
    try {
      object = await this.storage.getObject(key, {
        range: options?.range,
        ifNoneMatch: options?.ifNoneMatch,
      });
    } catch (error) {
      if (isNotModifiedError(error)) {
        return {
          notModified: true,
          stream: null,
          fileName,
          mimeType: fallbackMimeType,
          fullSize: options?.fullSize ?? 0n,
          etag: options?.ifNoneMatch,
        };
      }
      throw error;
    }
    if (!object.Body) throw new NotFoundException('素材文件不存在。');
    return {
      notModified: false,
      stream: object.Body as unknown as Readable,
      fileName,
      mimeType: object.ContentType ?? fallbackMimeType,
      contentLength: object.ContentLength,
      contentRange: object.ContentRange,
      fullSize: options?.fullSize ?? BigInt(object.ContentLength ?? 0),
      etag: object.ETag,
      lastModified: object.LastModified,
    };
  }
}

interface OpenedEagleMedia {
  notModified: boolean;
  stream: Readable | null;
  fileName: string;
  mimeType: string;
  contentLength?: number;
  contentRange?: string;
  fullSize: bigint;
  etag?: string;
  lastModified?: Date;
}

function isNotModifiedError(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotModified' || candidate.$metadata?.httpStatusCode === 304;
}
