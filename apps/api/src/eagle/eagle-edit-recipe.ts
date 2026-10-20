import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, Min } from 'class-validator';
import { readPhotoEditRecipe } from '@sekereagle/library-core';
import type { LibraryMode, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
export class SaveEagleEditRecipeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) mediaRevision!: number;
  @ApiProperty({ type: Object }) @IsObject() recipe!: object;
}
export function validatedEditRecipe(input: unknown) {
  try {
    return readPhotoEditRecipe(input);
  } catch {
    throw new BadRequestException('编辑参数无效或版本不受支持。');
  }
}
export async function readEagleEditRecipe(
  db: PrismaService,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  includePrivate: boolean,
) {
  const asset = await db.eagleAsset.findFirst({
    where: {
      id: assetId,
      ownerId,
      libraryMode,
      deletedAt: null,
      purgeAfter: null,
      ...(!includePrivate ? { isPrivate: false } : {}),
    },
    select: { mediaRevision: true },
  });
  if (!asset) throw new NotFoundException('照片不存在。');
  const row = await db.eagleAssetEditRecipe.findFirst({
    where: { assetId, ownerId, libraryMode, assetRevision: asset.mediaRevision },
  });
  if (!row) return null;
  return {
    recipe: validatedEditRecipe(row.recipe),
    baseAssetId: row.baseAssetId,
    baseMediaRevision: row.baseMediaRevision,
  };
}
export async function saveEagleEditRecipe(
  db: PrismaService,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  input: SaveEagleEditRecipeDto,
  includePrivate: boolean,
) {
  const recipe = validatedEditRecipe(input.recipe);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE id=${assetId} AND "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" FOR UPDATE`;
    const asset = await tx.eagleAsset.findFirst({
      where: {
        id: assetId,
        ownerId,
        libraryMode,
        deletedAt: null,
        purgeAfter: null,
        ...(!includePrivate ? { isPrivate: false } : {}),
      },
      select: { mediaRevision: true },
    });
    if (!asset) throw new NotFoundException('照片不存在。');
    if (asset.mediaRevision !== input.mediaRevision)
      throw new ConflictException('照片内容已变化，请重新打开编辑器。');
    const data = {
      ownerId,
      libraryMode,
      assetRevision: input.mediaRevision,
      baseAssetId: null,
      baseMediaRevision: input.mediaRevision,
      recipe: recipe as unknown as Prisma.InputJsonValue,
    };
    await tx.eagleAssetEditRecipe.upsert({
      where: { assetId },
      create: { assetId, ...data },
      update: data,
    });
    return { saved: true };
  });
}
