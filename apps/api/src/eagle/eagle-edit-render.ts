import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsUUID, Min, MaxLength, IsString } from 'class-validator';
import { randomUUID, createHash } from 'node:crypto';
import { Prisma, type LibraryMode } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { findWatermark } from '@sekereagle/photo-render-core/photo-watermark-model';
import { validatedEditRecipe } from './eagle-edit-recipe';
export class CreateEditRenderDto {
  @ApiProperty() @IsUUID() requestId!: string;
  @ApiProperty() @IsInt() @Min(1) mediaRevision!: number;
  @ApiProperty() @IsInt() @Min(1) rowVersion!: number;
  @ApiProperty({ type: Object }) @IsObject() recipe!: object;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4500000) lut?: string;
}
function scope(
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  includePrivate: boolean,
) {
  return {
    id: assetId,
    ownerId,
    libraryMode,
    deletedAt: null,
    purgeAfter: null,
    ...(!includePrivate ? { isPrivate: false } : {}),
  };
}
export async function createEditRender(
  db: PrismaService,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  input: CreateEditRenderDto,
  includePrivate: boolean,
) {
  const recipe = validatedEditRecipe(input.recipe);
  if (recipe.edits.watermark !== 'none' && !findWatermark(recipe.edits.watermark))
    throw new BadRequestException('水印模板不受支持。');
  // A portable LUT is numeric data, never a remote URL or an object-store path.
  if (recipe.edits.filter.startsWith('lut:') !== !!input.lut)
    throw new BadRequestException('自定义滤镜数据缺失或不匹配。');
  if (input.lut) {
    const { readPortableLut } = await import('@sekereagle/photo-render-core/portable-lut');
    try {
      readPortableLut(input.lut);
    } catch {
      throw new BadRequestException('自定义滤镜数据无效。');
    }
  }
  const payload = recipe;
  const intent = createHash('sha256')
    .update(
      JSON.stringify({
        assetId,
        requestId: input.requestId,
        mediaRevision: input.mediaRevision,
        rowVersion: input.rowVersion,
        recipe: payload,
        lut: input.lut ?? null,
      }),
    )
    .digest('hex');
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE id=${assetId} AND "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" FOR UPDATE`;
    const source = await tx.eagleAsset.findFirst({
      where: scope(ownerId, libraryMode, assetId, includePrivate),
    });
    if (!source) throw new NotFoundException('照片不存在。');
    if (source.mediaRevision !== input.mediaRevision || source.rowVersion !== input.rowVersion)
      throw new ConflictException('照片已变化，请重新打开编辑器。');
    if (!source.mimeType.startsWith('image/')) throw new BadRequestException('仅支持编辑图片。');
    // Owner-wide idempotency serializes equal request IDs, including across different sources.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`edit-render:${ownerId}:${libraryMode}:${input.requestId}`},0))::text`;
    const existing = await tx.eagleEditRender.findUnique({
      where: {
        ownerId_libraryMode_requestId: { ownerId, libraryMode, requestId: input.requestId },
      },
      include: { job: true },
    });
    if (existing) {
      if (existing.job.processorVersion !== `edit-v1:${intent}`)
        throw new ConflictException('保存标识已用于其他编辑。');
      return { id: existing.jobId };
    }
    const id = randomUUID();
    await tx.eagleAssetProcessingJob.create({
      data: {
        id,
        ownerId,
        libraryMode,
        assetId,
        kind: 'RENDER_EDITED_COPY',
        lane: 'INTERACTIVE',
        assetRevision: input.mediaRevision,
        processorVersion: `edit-v1:${intent}`,
        editRender: {
          create: {
            requestId: input.requestId,
            sourceRowVersion: input.rowVersion,
            lut: input.lut,
            recipe: payload as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });
    return { id };
  });
}
export async function readEditRender(
  db: PrismaService,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  id: string,
  includePrivate: boolean,
) {
  const source = await db.eagleAsset.findFirst({
    where: scope(ownerId, libraryMode, assetId, includePrivate),
  });
  if (!source) throw new NotFoundException('照片不存在。');
  const row = await db.eagleEditRender.findFirst({
    where: { jobId: id, ownerId, libraryMode, job: { assetId } },
    include: { job: true },
  });
  if (!row) throw new NotFoundException('保存任务不存在。');
  if (row.job.status === 'COMPLETED' && row.resultAssetId) {
    const result = await db.eagleAsset.findFirst({
      where: scope(ownerId, libraryMode, row.resultAssetId, includePrivate),
    });
    if (!result) throw new NotFoundException('成片不存在或当前不可见。');
    if (result.lifecycleStatus === 'PROCESSING') return { status: 'PROCESSING' };
    if (result.lifecycleStatus === 'FAILED')
      return { status: 'FAILED', message: '成片预览生成失败，请稍后重试。' };
    return { status: 'COMPLETED', asset: { id: result.id, name: result.originalName } };
  }
  if (
    source.mediaRevision !== row.job.assetRevision ||
    source.rowVersion !== row.sourceRowVersion ||
    ['FAILED', 'COMPLETED'].includes(row.job.status)
  )
    return { status: 'FAILED', message: '保存未完成，照片可能已变化，请重新打开后重试。' };
  return { status: row.job.status };
}
