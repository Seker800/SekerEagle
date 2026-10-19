import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Readable } from 'node:stream';
import { IMAGE_EDIT_MIME_TYPES, imageEditSize, validateImageEdit } from '@sekereagle/library-core';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { assertOwnedObjectKey } from '../storage/object-key';
import { LIBRARY_MODE } from './library-mode';
import { lockOwnerPrivacyProjection } from './eagle-privacy.service';
import { mediaInspectionBudget } from './media-inspection-budget';
import { buildImageProcessingJobs } from './media-job-plan';
import { renderImageEdit } from './eagle-image-edit-render';
import type { SaveImageEditDto } from './eagle-image-edit.dto';

const MAX_EDIT_BYTES = 100 * 1024 * 1024;

@Injectable()
export class EagleImageEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
  ) {}

  async save(ownerId: string, sourceId: string, input: SaveImageEditDto, includePrivate: boolean) {
    try {
      validateImageEdit(input.edit);
    } catch {
      throw new BadRequestException('图片编辑参数无效。');
    }
    const where = {
      id: sourceId,
      ownerId,
      libraryMode: this.libraryMode,
      deletedAt: null,
      purgeAfter: null,
      ...(includePrivate ? {} : { isPrivate: false }),
    };
    const source = await this.prisma.eagleAsset.findFirst({ where: { ...where, libraryMode: this.libraryMode } });
    if (!source) throw new NotFoundException('图片不存在。');
    if (source.rowVersion !== input.rowVersion)
      throw new ConflictException('图片已变化，请关闭编辑器并重新打开。');
    if (!(IMAGE_EDIT_MIME_TYPES as readonly string[]).includes(source.mimeType))
      throw new BadRequestException('该格式暂不支持图片编辑。');
    if (source.byteSize > BigInt(MAX_EDIT_BYTES) || !source.width || !source.height || source.lifecycleStatus !== 'READY')
      throw new BadRequestException('图片超出编辑大小限制或尚未处理完成。');
    assertOwnedObjectKey(ownerId, source.originalObjectKey);
    // Stable canonical JSON prevents property ordering from changing an idempotency declaration.
    const recipe = {
      crop: {
        x: input.edit.crop.x,
        y: input.edit.crop.y,
        width: input.edit.crop.width,
        height: input.edit.crop.height,
      },
      rotation: input.edit.rotation,
      flipX: input.edit.flipX,
      flipY: input.edit.flipY,
      brightness: input.edit.brightness,
      contrast: input.edit.contrast,
      saturation: input.edit.saturation,
    };
    let operation = await this.prisma.eagleImageEdit.findUnique({
      where: { id: input.operationId, ownerId, libraryMode: this.libraryMode },
    });
    if (!operation) {
      const targetId = randomUUID();
      try {
        operation = await this.prisma.eagleImageEdit.create({
          data: {
            id: input.operationId,
            ownerId,
            libraryMode: this.libraryMode,
            sourceId,
            sourceRowVersion: input.rowVersion,
            sourceRevision: source.mediaRevision,
            recipe,
            targetId,
            targetKey: `users/${ownerId}/assets/${targetId}/original.png`,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
          throw error;
        operation = await this.prisma.eagleImageEdit.findUnique({
          where: { id: input.operationId, ownerId, libraryMode: this.libraryMode },
        });
      }
    }
    if (!operation || operation.ownerId !== ownerId || operation.libraryMode !== this.libraryMode)
      throw new NotFoundException('编辑操作不存在。');
    if (
      operation.sourceId !== sourceId ||
      operation.sourceRowVersion !== input.rowVersion ||
      !isDeepStrictEqual(operation.recipe, recipe)
    )
      throw new ConflictException('编辑操作已用于其他修改。');
    const plan = operation;
    const result = { assetId: plan.targetId };
    if (plan.status === 'COMPLETED') {
      const target = await this.prisma.eagleAsset.findFirst({
        where: { ...where, id: plan.targetId, libraryMode: this.libraryMode },
      });
      if (!target) throw new NotFoundException('编辑副本不存在。');
      return result;
    }
    if (plan.status !== 'PENDING')
      throw new ConflictException('编辑操作已过期，请重新打开编辑器。');
    return mediaInspectionBudget.run(ownerId, async () => {
      const object = await this.storage.getObject(source.originalObjectKey);
      if (!object.Body) throw new NotFoundException('原图片不存在。');
      const body = object.Body as unknown as Readable;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > MAX_EDIT_BYTES) {
          body.destroy();
          throw new BadRequestException('图片超出编辑大小限制。');
        }
        chunks.push(buffer);
      }
      const output = await renderImageEdit(Buffer.concat(chunks), recipe);
      if (output.length > MAX_EDIT_BYTES)
        throw new BadRequestException('编辑结果超出大小限制，请缩小裁剪范围。');
      const dimensions = imageEditSize(recipe, source.width!, source.height!);
      // The durable operation owns the key before writing; retries reuse it after any interruption.
      assertOwnedObjectKey(ownerId, plan.targetKey);
      return this.prisma.$transaction(
        async (tx) => {
          await lockOwnerPrivacyProjection(tx, ownerId, this.libraryMode);
          await tx.$queryRaw`SELECT id FROM "EagleImageEdit" WHERE id=${plan.id} AND "ownerId"=${ownerId} FOR UPDATE`;
          const currentPlan = await tx.eagleImageEdit.findUniqueOrThrow({ where: { id: plan.id, ownerId, libraryMode: this.libraryMode } });
          if (currentPlan.status === 'COMPLETED') return result;
          if (currentPlan.status !== 'PENDING')
            throw new ConflictException('编辑操作已过期，请重新打开编辑器。');
          await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE id=${sourceId} AND "ownerId"=${ownerId} AND "libraryMode"=${this.libraryMode}::"LibraryMode" FOR UPDATE`;
          const current = await tx.eagleAsset.findFirst({
            where: { ...where, libraryMode: this.libraryMode },
            include: { annotation: true, manualTagLinks: true },
          });
          if (!current) throw new NotFoundException('图片不存在。');
          if (
            current.rowVersion !== input.rowVersion ||
            current.mediaRevision !== plan.sourceRevision ||
            current.originalObjectKey !== source.originalObjectKey
          )
            throw new ConflictException('图片已变化，请重新打开编辑器。');
          // Hold the operation lock through the write so abandoned-operation cleanup cannot race it.
          await this.storage.putObject(plan.targetKey, output, 'image/png');
          const displayName = `${current.displayName.slice(0, 240)} · edited`;
          await tx.eagleAsset.create({
            data: {
              id: plan.targetId,
              ownerId,
              libraryMode: this.libraryMode,
              originalName: `${current.originalName.replace(/\.[^.]+$/, '').slice(0, 235)}-edited.png`,
              displayName,
              normalizedDisplayName: displayName.normalize('NFKC').trim().toLowerCase(),
              mimeType: 'image/png',
              format: 'png',
              byteSize: BigInt(output.length),
              sha256: createHash('sha256').update(output).digest('hex'),
              originalObjectKey: plan.targetKey,
              ...dimensions,
              mediaRevision: 1,
              rating: current.rating,
              isPrivate: current.isPrivate,
              chronologicalAt: current.chronologicalAt,
              lifecycleStatus: 'PROCESSING',
            },
          });
          if (current.annotation)
            await tx.eagleAssetAnnotation.create({
              data: {
                ownerId,
                libraryMode: this.libraryMode,
                assetId: plan.targetId,
                description: current.annotation.description,
                sourceUrl: current.annotation.sourceUrl,
              },
            });
          if (current.manualTagLinks.length)
            await tx.eagleAssetManualTag.createMany({
              data: current.manualTagLinks.map((link) => ({
                ownerId,
                libraryMode: this.libraryMode,
                assetId: plan.targetId,
                tagId: link.tagId,
                assignedByUser: true,
                assignmentProvenance: 'USER_ASSIGNED',
              })),
            });
          await tx.eagleAssetProcessingJob.createMany({
            data: buildImageProcessingJobs({
              ownerId,
              assetId: plan.targetId,
              assetRevision: 1,
              ...dimensions,
            }).map((job) => ({ ...job, libraryMode: this.libraryMode })),
          });
          await tx.eagleImageEdit.update({ where: { id: plan.id, ownerId, libraryMode: this.libraryMode }, data: { status: 'COMPLETED' } });
          return result;
        },
        { timeout: 30000 },
      );
    });
  }
}

