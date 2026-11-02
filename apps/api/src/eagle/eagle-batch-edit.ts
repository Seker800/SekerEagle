import type { LibraryMode } from '@prisma/client';
import { databaseBatches, DATABASE_STATEMENTS } from './eagle-database-batches';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { createHash } from 'node:crypto';
import {
  DEFAULT_PHOTO_EDITS,
  selectPhotoEditParts,
  type PhotoEditParts,
} from '@sekereagle/library-core';
import { readPortableLut } from '@sekereagle/photo-render-core/portable-lut';
import type { PrismaService } from '../prisma/prisma.service';
import { LibraryCommandRegistry, type LibraryCommandContext } from './eagle-library-command';
import { createEditRender } from './eagle-edit-render';
import { validatedEditRecipe } from './eagle-edit-recipe';
class BatchEditPartsDto implements PhotoEditParts {
  @ApiProperty() @IsBoolean() adjustments!: boolean;
  @ApiProperty() @IsBoolean() filter!: boolean;
  @ApiProperty() @IsBoolean() watermark!: boolean;
  @ApiProperty() @IsBoolean() crop!: boolean;
}
export class BatchEditRendersDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') operationId?: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  assetIds!: string[];
  @ApiProperty({ type: Object }) @IsObject() recipe!: object;
  @ApiProperty({ type: BatchEditPartsDto })
  @ValidateNested()
  @Type(() => BatchEditPartsDto)
  parts!: BatchEditPartsDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4500000) lut?: string;
  @ApiPropertyOptional({ type: Object, additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  preservedLuts?: Record<string, string>;
}
export class BatchEditRenderContextDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  assetIds!: string[];
}
export class BatchEditRenderContextResponseDto {
  @ApiProperty({ type: [String] }) preservedFilterIds!: string[];
}

/** Read only the required local-table IDs; image data and saved recipes never leave this scope. */
export async function readBatchEditRenderContext(
  db: PrismaService,
  ownerId: string,
  libraryMode: LibraryMode,
  assetIds: string[],
  includePrivate: boolean,
): Promise<BatchEditRenderContextResponseDto> {
  const missing = new Set<string>();
  for (const { rows: ids } of databaseBatches(
    [...new Set(assetIds)],
    DATABASE_STATEMENTS.operationAssetLookup,
  )) {
    const assets = await db.eagleAsset.findMany({
      where: {
        ownerId,
        libraryMode,
        id: { in: ids },
        deletedAt: null,
        purgeAfter: null,
        ...(!includePrivate ? { isPrivate: false } : {}),
      },
      select: { id: true, mediaRevision: true },
    });
    if (assets.length !== ids.length) throw new NotFoundException('照片不存在。');
    const revisions = new Map(assets.map((asset) => [asset.id, asset.mediaRevision]));
    const stored = await db.eagleAssetEditRecipe.findMany({
      where: { ownerId, libraryMode, assetId: { in: ids } },
      select: { assetId: true, assetRevision: true, recipe: true },
    });
    const filters = new Map<string, string>();
    for (const row of stored) {
      if (row.assetRevision !== revisions.get(row.assetId)) continue;
      const filter = validatedEditRecipe(row.recipe).edits.filter;
      if (filter.startsWith('lut:')) filters.set(row.assetId, filter);
    }
    if (!filters.size) continue;
    const renders = await db.eagleEditRender.findMany({
      where: {
        ownerId,
        libraryMode,
        resultAssetId: { in: [...filters.keys()] },
        job: { status: 'COMPLETED' },
        OR: [{ lut: { not: null } }, { commandOperationId: { not: null } }],
      },
      select: { resultAssetId: true, recipe: true },
    });
    const durable = new Set(
      renders
        .filter(
          (row) =>
            row.resultAssetId &&
            validatedEditRecipe(row.recipe).edits.filter === filters.get(row.resultAssetId),
        )
        .map((row) => row.resultAssetId),
    );
    for (const [assetId, filter] of filters) if (!durable.has(assetId)) missing.add(filter);
  }
  return { preservedFilterIds: [...missing].sort() };
}

function preservedLut(payload: Record<string, unknown>, filter: string): string | undefined {
  const bank = payload.preservedLuts;
  if (!bank || typeof bank !== 'object' || Array.isArray(bank)) return undefined;
  const value = (bank as Record<string, unknown>)[filter];
  return typeof value === 'string' ? value : undefined;
}

function renderRequestId(operationId: string, assetId: string) {
  const bytes = createHash('sha256')
    .update(JSON.stringify([operationId, assetId]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Expand to existing durable media jobs; no decoded image or upload lives in the browser. */
export function registerBatchEditCommands(registry: LibraryCommandRegistry, db: PrismaService) {
  registry.register('BATCH_EDIT_RENDER', {
    protocol: 'METADATA',
    partition: (payload, ids) => ids.map((id) => ({ payload, assetIds: [id] })),
    admit: (_context, payload) => {
      const recipe = validatedEditRecipe(payload.recipe);
      const filterSelected = (payload.parts as unknown as PhotoEditParts)?.filter;
      if (filterSelected && recipe.edits.filter.startsWith('lut:')) {
        try {
          readPortableLut(payload.lut as string);
        } catch {
          throw new BadRequestException('自定义滤镜数据无效。');
        }
      }
      const bank = payload.preservedLuts;
      if (bank !== undefined) {
        if (!bank || typeof bank !== 'object' || Array.isArray(bank))
          throw new BadRequestException('保留滤镜数据无效。');
        for (const [filter, data] of Object.entries(bank)) {
          if (!filter.startsWith('lut:') || typeof data !== 'string')
            throw new BadRequestException('保留滤镜数据无效。');
          try {
            readPortableLut(data);
          } catch {
            throw new BadRequestException('保留滤镜数据无效。');
          }
        }
      }
      const parts = payload.parts as unknown as PhotoEditParts;
      if (!parts || !Object.values(parts).some(Boolean))
        throw new BadRequestException('请选择要套用的编辑内容。');
    },
    apply: async (tx, context: LibraryCommandContext, payload, ids) => {
      const recipe = validatedEditRecipe(payload.recipe);
      const parts = payload.parts as unknown as PhotoEditParts;
      for (const assetId of ids) {
        const where = {
          ownerId: context.ownerId,
          libraryMode: context.libraryMode,
          deletedAt: null,
          purgeAfter: null,
          ...(!context.includePrivate ? { isPrivate: false } : {}),
        };
        const target = await tx.eagleAsset.findFirst({ where: { ...where, id: assetId } });
        if (!target) throw new NotFoundException('照片不存在。');
        const stored = await tx.eagleAssetEditRecipe.findFirst({
          where: {
            assetId,
            ownerId: context.ownerId,
            libraryMode: context.libraryMode,
            assetRevision: target.mediaRevision,
          },
        });
        const base = stored?.baseAssetId
          ? await tx.eagleAsset.findFirst({ where: { ...where, id: stored.baseAssetId } })
          : target;
        if (!base) throw new NotFoundException('原照片不存在。');
        if (stored && base.mediaRevision !== stored.baseMediaRevision)
          throw new ConflictException('原照片内容已变化。');
        const edits = selectPhotoEditParts(
          recipe.edits,
          stored ? validatedEditRecipe(stored.recipe).edits : DEFAULT_PHOTO_EDITS,
          parts,
        );
        // A partial paste keeps the target's filter and its numeric table together.
        // Clipboard LUT bytes belong only to a selected clipboard filter.
        let lut: string | undefined;
        let lutOperationId: string | undefined;
        if (edits.filter.startsWith('lut:')) {
          if (parts.filter) lutOperationId = context.operationId;
          else {
            const originalRender = await tx.eagleEditRender.findFirst({
              where: {
                ownerId: context.ownerId,
                libraryMode: context.libraryMode,
                resultAssetId: assetId,
                recipe: { path: ['edits', 'filter'], equals: edits.filter },
                job: { status: 'COMPLETED' },
              },
              select: { lut: true, commandOperationId: true },
            });
            lut = originalRender?.lut ?? undefined;
            lutOperationId = originalRender?.commandOperationId ?? undefined;
            if (!lut && !lutOperationId && preservedLut(payload, edits.filter))
              lutOperationId = context.operationId;
          }
        }
        await createEditRender(
          db,
          context.ownerId,
          context.libraryMode,
          base.id,
          {
            requestId: renderRequestId(context.operationId, assetId),
            mediaRevision: base.mediaRevision,
            rowVersion: base.rowVersion,
            recipe: { version: 1, edits },
            ...(lut ? { lut } : {}),
          },
          context.includePrivate,
          tx,
          lutOperationId,
        );
      }
    },
  });
}
