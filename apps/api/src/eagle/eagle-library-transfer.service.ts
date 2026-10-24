import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type LibraryMode, type EagleLibraryTransfer } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { assertOwnedObjectKey } from '../storage/object-key';
import { LIBRARY_MODE } from './library-mode';
import { buildImageProcessingJobs } from './media-job-plan';
import { resolveLivePhotoMotions } from './live-photo-projection';
import { lockOwnerPrivacyProjection } from './eagle-privacy.service';
import type { SendEagleAssetsDto } from './eagle.dto';

interface TransferItem {
  sourceId: string;
  targetId: string;
  revision: number;
  rowVersion: number;
  sourceKey: string;
  targetKey: string;
  size: string;
}
export interface LibraryTransferResult {
  targetMode: LibraryMode;
  movedCount: number;
  componentCount: number;
  assets: Array<{ sourceId: string; assetId: string }>;
}
@Injectable()
export class EagleLibraryTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    @Optional() @Inject(LIBRARY_MODE) private readonly sourceMode: LibraryMode = 'MATERIAL',
  ) {}
  private libraryModeWhere(ownerId: string, ids: string[], includePrivate: boolean) {
    return {
      ownerId,
      libraryMode: this.sourceMode,
      id: { in: ids },
      deletedAt: null,
      ...(includePrivate ? {} : { isPrivate: false }),
    };
  }
  private async targetPrivacyTag(
    tx: Prisma.TransactionClient,
    ownerId: string,
    libraryMode: LibraryMode,
  ): Promise<string> {
    // Never change a public tag with a colliding name: that would classify unrelated assets.
    for (let suffix = 0; suffix < 100; suffix++) {
      const name = suffix ? `跨库私密 ${suffix + 1}` : '跨库私密';
      const tag = await tx.eagleManualTag.upsert({
        where: {
          ownerId_libraryMode_normalizedName: { ownerId, libraryMode, normalizedName: name },
        },
        update: {},
        create: { ownerId, libraryMode, name, normalizedName: name, marksAssetsPrivate: true },
      });
      if (tag.marksAssetsPrivate) return tag.id;
    }
    throw new ConflictException('无法创建目标私密标签，请调整标签名称后重试。');
  }
  private checkOperation(operation: EagleLibraryTransfer, ownerId: string, ids: string[]) {
    if (operation.ownerId !== ownerId || operation.sourceMode !== this.sourceMode)
      throw new NotFoundException('发送操作不存在。');
    if (operation.status === 'ABANDONED')
      throw new ConflictException('发送操作已过期，请重新发送。');
    if (JSON.stringify([...operation.sourceIds].sort()) !== JSON.stringify(ids))
      throw new BadRequestException('发送操作与所选图片不一致。');
  }
  async send(
    ownerId: string,
    input: SendEagleAssetsDto,
    includePrivate: boolean,
    expected?: ReadonlyMap<string, { mediaRevision: number; rowVersion: number }>,
  ): Promise<LibraryTransferResult> {
    const ids = [...new Set(input.assetIds)].sort();
    if (!ids.length || ids.length !== input.assetIds.length || ids.length > 100)
      throw new BadRequestException('请选择不重复的图片。');
    let operation = await this.prisma.eagleLibraryTransfer.findUnique({
      where: { id: input.operationId, ownerId, sourceMode: this.sourceMode },
    });
    if (operation) {
      this.checkOperation(operation, ownerId, ids);
      if (operation.status === 'COMPLETED')
        return operation.result as unknown as LibraryTransferResult;
    }
    const selected = await this.prisma.eagleAsset.findMany({
      where: this.libraryModeWhere(ownerId, ids, includePrivate),
    });
    if (selected.length !== ids.length) throw new NotFoundException('一个或多个图片不存在。');
    if (
      expected &&
      selected.some((row) => {
        const snapshot = expected.get(row.id);
        return (
          !snapshot ||
          snapshot.mediaRevision !== row.mediaRevision ||
          snapshot.rowVersion !== row.rowVersion
        );
      })
    )
      throw new ConflictException('照片已变化，请重新提交申请。');
    if (selected.some((row) => !row.mimeType.startsWith('image/')))
      throw new BadRequestException('请选择图片；配对实况视频会自动随照片发送。');
    if (selected.some((row) => row.lifecycleStatus !== 'READY'))
      throw new ConflictException('请等待图片处理完成后发送。');
    const targetMode = this.sourceMode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
    if (!operation) {
      const motions = await resolveLivePhotoMotions(
        this.prisma,
        { ownerId, libraryMode: this.sourceMode },
        selected,
        includePrivate,
      );
      const componentIds = [
        ...new Set([...ids, ...[...motions.values()].map((row) => row.assetId)]),
      ];
      const components = await this.prisma.eagleAsset.findMany({
        where: this.libraryModeWhere(ownerId, componentIds, includePrivate),
      });
      if (components.length !== componentIds.length)
        throw new NotFoundException('实况照片组件不存在。');
      const items: TransferItem[] = components.map((row) => {
        assertOwnedObjectKey(ownerId, row.originalObjectKey);
        const targetId = randomUUID();
        return {
          sourceId: row.id,
          targetId,
          revision: row.mediaRevision,
          rowVersion: row.rowVersion,
          sourceKey: row.originalObjectKey,
          targetKey: `users/${ownerId}/assets/${targetId}/original.${row.format.replace(/[^a-z0-9]/gi, '') || 'bin'}`,
          size: String(row.byteSize),
        };
      });
      try {
        operation = await this.prisma.eagleLibraryTransfer.upsert({
          where: { id: input.operationId, ownerId, sourceMode: this.sourceMode },
          update: {},
          create: {
            id: input.operationId,
            ownerId,
            sourceMode: this.sourceMode,
            targetMode,
            sourceIds: ids,
            plan: items.map((item) => ({ ...item })),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new NotFoundException('发送操作不存在。');
        throw error;
      }

      this.checkOperation(operation, ownerId, ids);
      if (operation.status === 'COMPLETED')
        return operation.result as unknown as LibraryTransferResult;
    }
    const items = operation.plan as unknown as TransferItem[];
    if (!Array.isArray(items) || !items.length || items.length > 200)
      throw new ConflictException('发送计划无效。');
    const currentSources = await this.prisma.eagleAsset.findMany({
      where: this.libraryModeWhere(
        ownerId,
        items.map((item) => item.sourceId),
        includePrivate,
      ),
    });
    if (
      currentSources.length !== items.length ||
      items.some((item) => {
        const source = currentSources.find((row) => row.id === item.sourceId);
        return (
          !source ||
          source.mediaRevision !== item.revision ||
          source.rowVersion !== item.rowVersion ||
          source.originalObjectKey !== item.sourceKey
        );
      })
    )
      throw new ConflictException('图片已变化或不再可访问，请刷新后重新发送。');
    // The durable plan owns these keys before copying; retrying never creates additional copies.
    for (const item of items) {
      const active = await this.prisma.eagleLibraryTransfer.findUniqueOrThrow({
        where: { id: operation.id, ownerId, sourceMode: this.sourceMode },
      });
      this.checkOperation(active, ownerId, ids);
      assertOwnedObjectKey(ownerId, item.sourceKey);
      assertOwnedObjectKey(ownerId, item.targetKey);
      await this.storage.copyObject(item.sourceKey, item.targetKey);
      const object = await this.storage.headObject(item.targetKey);
      if (BigInt(object.ContentLength ?? -1) !== BigInt(item.size))
        throw new ConflictException('原文件复制校验失败，请重试。');
    }
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "EagleLibraryTransfer" WHERE id=${operation.id} AND "ownerId"=${ownerId} FOR UPDATE`;
        const currentOperation = await tx.eagleLibraryTransfer.findUniqueOrThrow({
          where: { id: operation.id, ownerId, sourceMode: this.sourceMode },
        });
        this.checkOperation(currentOperation, ownerId, ids);
        if (currentOperation.status === 'COMPLETED')
          return currentOperation.result as unknown as LibraryTransferResult;
        // Match tag mutation lock order before taking asset row locks.
        for (const mode of ['MATERIAL', 'PHOTO'] as const)
          await lockOwnerPrivacyProjection(tx, ownerId, mode);
        const sourceIds = items.map((item) => item.sourceId).sort();
        await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"=${this.sourceMode}::"LibraryMode" AND id=ANY(${sourceIds}::text[]) ORDER BY id FOR UPDATE`;
        const sources = await tx.eagleAsset.findMany({
          where: this.libraryModeWhere(ownerId, sourceIds, includePrivate),
          include: { annotation: true },
        });
        if (sources.length !== items.length)
          throw new ConflictException('图片已变化或不再可访问，请刷新后重试。');
        for (const item of items) {
          const source = sources.find((row) => row.id === item.sourceId)!;
          if (
            source.mediaRevision !== item.revision ||
            source.rowVersion !== item.rowVersion ||
            source.originalObjectKey !== item.sourceKey ||
            source.lifecycleStatus !== 'READY'
          )
            throw new ConflictException('图片已变化，请刷新后重新发送。');
          await tx.eagleAsset.create({
            data: {
              id: item.targetId,
              ownerId,
              libraryMode: targetMode,
              originalName: source.originalName,
              displayName: source.displayName,
              normalizedDisplayName: source.normalizedDisplayName,
              mimeType: source.mimeType,
              format: source.format,
              byteSize: source.byteSize,
              sha256: source.sha256,
              originalObjectKey: item.targetKey,
              width: source.width,
              height: source.height,
              durationMs: source.durationMs,
              rating: source.rating,
              isPrivate: source.isPrivate,
              mediaRevision: 1,
              lifecycleStatus: 'PROCESSING',
            },
          });
          if (source.isPrivate) {
            const tagId = await this.targetPrivacyTag(tx, ownerId, targetMode);
            await tx.eagleAssetManualTag.create({
              data: { ownerId, libraryMode: targetMode, assetId: item.targetId, tagId },
            });
          }
          if (source.annotation)
            await tx.eagleAssetAnnotation.create({
              data: {
                ownerId,
                libraryMode: targetMode,
                assetId: item.targetId,
                color: source.annotation.color,
                description: source.annotation.description,
                sourceUrl: source.annotation.sourceUrl,
              },
            });
          const jobs = source.mimeType.startsWith('image/')
            ? buildImageProcessingJobs({
                ownerId,
                assetId: item.targetId,
                assetRevision: 1,
                width: source.width,
                height: source.height,
              })
            : [
                {
                  ownerId,
                  assetId: item.targetId,
                  assetRevision: 1,
                  kind: 'GENERATE_THUMBNAIL' as const,
                  lane: 'INTERACTIVE' as const,
                  processorVersion: 'camera-video-preview-v2',
                },
              ];
          await tx.eagleAssetProcessingJob.createMany({
            data: jobs.map((job) => ({ ...job, libraryMode: targetMode })),
          });
        }
        await tx.eagleAsset.updateMany({
          where: this.libraryModeWhere(ownerId, sourceIds, includePrivate),
          data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
        });
        const result: LibraryTransferResult = {
          targetMode,
          movedCount: ids.length,
          componentCount: items.length,
          assets: items.map((item) => ({ sourceId: item.sourceId, assetId: item.targetId })),
        };
        await tx.eagleLibraryTransfer.update({
          where: { id: operation.id, ownerId, sourceMode: this.sourceMode },
          data: { status: 'COMPLETED', result: result as unknown as Prisma.InputJsonValue },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
}
