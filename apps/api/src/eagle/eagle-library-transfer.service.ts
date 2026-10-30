import { runTransferWork } from './eagle-transfer-work';
import {
  planTransferPyramid,
  copyTransferPyramid,
  pyramidStoragePrefix,
  type TransferPyramid,
} from './eagle-transfer-pyramid';
import { isCameraRawMime } from '@sekereagle/library-core';
import { copyTransferFacts, transferFactIncludes } from './eagle-transfer-facts';
import {
  planTransferRenditions,
  transferredBrowsingReady,
  type TransferRendition,
} from './eagle-transfer-renditions';
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
  renditions?: TransferRendition[];
  pyramid?: TransferPyramid;
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
    guard?: {
      beforePublish: (tx: Prisma.TransactionClient) => Promise<void>;
      componentIds: readonly string[];
    },
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
    const checkExpected = (
      rows: Array<{ id: string; mediaRevision: number; rowVersion: number }>,
    ) => {
      if (
        expected &&
        [
          ...new Set([...ids, ...rows.filter((row) => expected.has(row.id)).map((row) => row.id)]),
        ].some((id) => {
          const row = rows.find((candidate) => candidate.id === id),
            snapshot = expected.get(id);
          return (
            !row ||
            !snapshot ||
            snapshot.mediaRevision !== row.mediaRevision ||
            snapshot.rowVersion !== row.rowVersion
          );
        })
      )
        throw new ConflictException('照片已变化，请重新提交申请。');
    };
    checkExpected(selected);
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
        include: {
          renditions: {
            where: { status: 'READY', kind: { in: ['THUMBNAIL', 'PREVIEW', 'POSTER'] } },
          },
          imagePyramids: true,
        },
      });
      if (components.length !== componentIds.length)
        throw new NotFoundException('实况照片组件不存在。');
      checkExpected(components);
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
          pyramid: planTransferPyramid(
            ownerId,
            targetId,
            row.mediaRevision,
            row.imagePyramids ?? [],
          ),
          renditions: planTransferRenditions(
            ownerId,
            targetId,
            row.mediaRevision,
            row.renditions ?? [],
          ),
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
            plan: JSON.parse(JSON.stringify(items)) as Prisma.InputJsonValue,
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
    if (
      guard &&
      JSON.stringify(items.map((item) => item.sourceId).sort()) !==
        JSON.stringify([...guard.componentIds].sort())
    )
      throw new ConflictException('实况照片组件已变化。');
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
    checkExpected(currentSources);
    // The durable plan owns these keys before copying; retrying never creates additional copies.
    for (const item of items) {
      const active = await this.prisma.eagleLibraryTransfer.findUniqueOrThrow({
        where: { id: operation.id, ownerId, sourceMode: this.sourceMode },
      });
      this.checkOperation(active, ownerId, ids);
      const objects = [
        { sourceKey: item.sourceKey, targetKey: item.targetKey, size: item.size },
        ...(item.renditions ?? []),
      ];
      // Validate the whole bounded plan before starting any writes for this component.
      for (const object of objects) {
        assertOwnedObjectKey(ownerId, object.sourceKey);
        assertOwnedObjectKey(ownerId, object.targetKey);
      }
      await runTransferWork(objects, async (object) => {
        await this.storage.copyObject(object.sourceKey, object.targetKey);
        const copied = await this.storage.headObject(object.targetKey);
        if (BigInt(copied.ContentLength ?? -1) !== BigInt(object.size))
          throw new ConflictException('文件复制校验失败，请重试。');
      });
      if (item.pyramid) await copyTransferPyramid(this.storage, ownerId, item.pyramid);
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
          include: transferFactIncludes,
        });
        if (sources.length !== items.length)
          throw new ConflictException('图片已变化或不再可访问，请刷新后重试。');
        checkExpected(sources);
        if (guard) await guard.beforePublish(tx);
        const liveIdentifiers = new Map<string, string>();
        for (const source of sources)
          if (source.livePhotoIdentifier && !liveIdentifiers.has(source.livePhotoIdentifier))
            liveIdentifiers.set(
              source.livePhotoIdentifier,
              items.find((item) => item.sourceId === source.id)!.targetId,
            );
        for (const item of items) {
          const source = sources.find((row) => row.id === item.sourceId)!;
          if (
            source.mediaRevision !== item.revision ||
            source.rowVersion !== item.rowVersion ||
            source.originalObjectKey !== item.sourceKey ||
            source.lifecycleStatus !== 'READY'
          )
            throw new ConflictException('图片已变化，请刷新后重新发送。');
          const copiedRenditions = item.renditions ?? [];
          if (
            copiedRenditions.some(
              (r) =>
                !source.renditions.some(
                  (current) =>
                    current.id === r.id &&
                    current.revision === item.revision &&
                    current.status === 'READY' &&
                    current.storageKey === r.sourceKey &&
                    String(current.byteSize) === r.size,
                ),
            )
          )
            throw new ConflictException('预览已变化，请重新发送。');
          if (
            item.pyramid &&
            !source.imagePyramids.some(
              (p) =>
                p.id === item.pyramid!.id &&
                p.revision === item.revision &&
                p.status === 'READY' &&
                pyramidStoragePrefix(p.storagePrefix) ===
                  pyramidStoragePrefix(item.pyramid!.storagePrefix) &&
                String(p.byteSize) === item.pyramid!.size,
            )
          )
            throw new ConflictException('切片已变化，请重新发送。');
          const browsingReady =
            source.mimeType.startsWith('image/') && transferredBrowsingReady(copiedRenditions);
          const motionReady =
            source.livePhotoRole === 'MOTION' &&
            copiedRenditions.some((r) => r.kind === 'PREVIEW' && r.mimeType === 'video/mp4');
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
              chronologicalAt: source.chronologicalAt,
              livePhotoIdentifier: source.livePhotoIdentifier
                ? liveIdentifiers.get(source.livePhotoIdentifier)
                : null,
              livePhotoRole: source.livePhotoRole,
              isPrivate: source.isPrivate,
              mediaRevision: 1,
              lifecycleStatus:
                (browsingReady && targetMode === 'MATERIAL') || motionReady
                  ? 'READY'
                  : 'PROCESSING',
            },
          });
          if (copiedRenditions.length)
            await tx.eagleAssetRendition.createMany({
              data: copiedRenditions.map((r) => ({
                ownerId,
                libraryMode: targetMode,
                assetId: item.targetId,
                kind: r.kind,
                variant: r.variant,
                revision: 1,
                storageKey: r.targetKey,
                mimeType: r.mimeType,
                byteSize: BigInt(r.size),
                width: r.width,
                height: r.height,
                status: 'READY',
              })),
            });
          if (item.pyramid) {
            const p = item.pyramid;
            await tx.eagleImagePyramid.create({
              data: {
                ownerId,
                libraryMode: targetMode,
                assetId: item.targetId,
                revision: 1,
                processorVersion: p.processorVersion,
                status: 'READY',
                storagePrefix: pyramidStoragePrefix(p.targetPrefix),
                tileSize: p.tileSize,
                overlap: p.overlap,
                format: p.format,
                width: p.width,
                height: p.height,
                maxLevel: p.maxLevel,
                tileCount: p.tileCount,
                byteSize: BigInt(p.size),
                completedAt: p.completedAt,
              },
            });
          }
          const facts = await copyTransferFacts(tx, ownerId, targetMode, item.targetId, source);
          if (browsingReady && targetMode === 'PHOTO' && facts.photoMetadataReady)
            await tx.eagleAsset.update({
              where: { id: item.targetId, ownerId, libraryMode: targetMode },
              data: { lifecycleStatus: 'READY' },
            });
          if (source.isPrivate && !facts.hasPrivateTag) {
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
                renditionsReady:
                  browsingReady && (targetMode === 'MATERIAL' || facts.photoMetadataReady),
                needsDetails: targetMode === 'PHOTO' || isCameraRawMime(source.mimeType),
                detailsReady: facts.detailsReady,
                embeddingReady: facts.embeddingReady,
                paletteReady: facts.paletteReady,
                pyramidReady: Boolean(item.pyramid),
              })
            : motionReady
              ? []
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
        // Publishing the independent target and retiring the source are atomic.
        // Keep the non-restorable source identity for approval history and privacy checks.
        // Only source objects enter the existing durable deletion outbox.
        const retiredAt = new Date();
        const retired = await tx.eagleAsset.updateMany({
          where: this.libraryModeWhere(ownerId, sourceIds, includePrivate),
          data: {
            deletedAt: retiredAt,
            purgeAfter: retiredAt,
            transferredAt: retiredAt,
            rowVersion: { increment: 1 },
          },
        });
        if (retired.count !== items.length)
          throw new ConflictException('图片已变化或不再可访问，请刷新后重试。');
        const objectKeys = [
          ...new Set(
            sources.flatMap((source) => [
              source.originalObjectKey,
              ...source.renditions.map((r) => r.storageKey),
            ]),
          ),
        ];
        const prefixes = sources.flatMap((source) =>
          source.imagePyramids.map((p) => `${pyramidStoragePrefix(p.storagePrefix)}/`),
        );
        for (const key of [...objectKeys, ...prefixes]) assertOwnedObjectKey(ownerId, key);
        await tx.eagleObjectDeletion.create({
          data: { ownerId, libraryMode: this.sourceMode, objectKeys, prefixes },
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
