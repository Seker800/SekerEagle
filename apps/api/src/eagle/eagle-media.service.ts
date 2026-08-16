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

  async getOriginal(ownerId: string, assetId: string) {
    const asset = await this.prisma.eagleAsset.findFirst({
      where: { ownerId, id: assetId, deletedAt: null },
      select: { originalObjectKey: true, originalName: true, mimeType: true },
    });
    if (!asset) throw new NotFoundException('素材不存在。');
    return this.open(ownerId, asset.originalObjectKey, asset.originalName, asset.mimeType);
  }

  async getRendition(ownerId: string, assetId: string, renditionId: string) {
    const rendition = await this.prisma.eagleAssetRendition.findFirst({
      where: { ownerId, assetId, id: renditionId, status: 'READY', asset: { deletedAt: null } },
      select: { storageKey: true, mimeType: true, kind: true },
    });
    if (!rendition) throw new NotFoundException('预览文件不存在。');
    return this.open(
      ownerId,
      rendition.storageKey,
      `${rendition.kind.toLowerCase()}.webp`,
      rendition.mimeType,
    );
  }

  private async open(ownerId: string, key: string, fileName: string, fallbackMimeType: string) {
    assertOwnedObjectKey(ownerId, key);
    const object = await this.storage.getObject(key);
    if (!object.Body) throw new NotFoundException('素材文件不存在。');
    return {
      stream: object.Body as unknown as Readable,
      fileName,
      mimeType: object.ContentType ?? fallbackMimeType,
      contentLength: object.ContentLength,
      etag: object.ETag,
    };
  }
}
