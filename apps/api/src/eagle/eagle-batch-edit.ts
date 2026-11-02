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
      validatedEditRecipe(payload.recipe);
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
        if (edits.filter.startsWith('lut:')) {
          if (parts.filter) lut = payload.lut as string | undefined;
          else {
            const originalRender = await tx.eagleEditRender.findFirst({
              where: {
                ownerId: context.ownerId,
                libraryMode: context.libraryMode,
                resultAssetId: assetId,
                recipe: { path: ['edits', 'filter'], equals: edits.filter },
                job: { status: 'COMPLETED' },
              },
              select: { lut: true },
            });
            lut = originalRender?.lut ?? undefined;
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
        );
      }
    },
  });
}
