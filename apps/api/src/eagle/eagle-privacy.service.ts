import type { LibraryMode } from '@prisma/client';
import { LIBRARY_MODE } from './library-mode';
import { Injectable, NotFoundException, Optional, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface EaglePrivacySettings {
  tagIds: string[];
}

export async function lockOwnerPrivacyProjection(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode = 'MATERIAL',
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`sekereagle:privacy:${ownerId}:${libraryMode}`}, 0)
    )::text AS "lockResult"
  `);
}

export async function syncAssetPrivacyFromManualTags(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  assetIds?: string[],
  libraryMode: LibraryMode = 'MATERIAL',
): Promise<number> {
  await lockOwnerPrivacyProjection(transaction, ownerId, libraryMode);
  const assetScope = assetIds ? { id: { in: assetIds } } : {};
  const madePublic = await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      libraryMode,
      ...assetScope,
      isPrivate: true,
      manualTagLinks: { none: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: false, rowVersion: { increment: 1 } },
  });
  const madePrivate = await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      libraryMode,
      ...assetScope,
      isPrivate: false,
      manualTagLinks: { some: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: true, rowVersion: { increment: 1 } },
  });
  return madePublic.count + madePrivate.count;
}

@Injectable()
export class EaglePrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
  ) {}

  async getSettings(ownerId: string): Promise<EaglePrivacySettings> {
    const tags = await this.prisma.eagleManualTag.findMany({
      where: { ownerId, marksAssetsPrivate: true, libraryMode: this.libraryMode },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return { tagIds: tags.map(({ id }) => id) };
  }

  async updateSettings(
    ownerId: string,
    input: EaglePrivacySettings,
  ): Promise<EaglePrivacySettings> {
    const tagIds = [...new Set(input.tagIds)];
    await this.prisma.$transaction(async (transaction) => {
      await lockOwnerPrivacyProjection(transaction, ownerId, this.libraryMode);
      const ownedTagCount = await transaction.eagleManualTag.count({
        where: { ownerId, id: { in: tagIds }, libraryMode: this.libraryMode },
      });
      if (ownedTagCount !== tagIds.length) {
        throw new NotFoundException('一个或多个标签不存在。');
      }
      await transaction.eagleManualTag.updateMany({
        where: {
          ownerId,
          marksAssetsPrivate: true,
          ...(tagIds.length ? { id: { notIn: tagIds } } : {}),
          libraryMode: this.libraryMode,
        },
        data: { marksAssetsPrivate: false },
      });
      if (tagIds.length) {
        const marked = await transaction.eagleManualTag.updateMany({
          where: { ownerId, id: { in: tagIds }, libraryMode: this.libraryMode },
          data: { marksAssetsPrivate: true },
        });
        if (marked.count !== tagIds.length) {
          throw new NotFoundException('一个或多个标签不存在。');
        }
      }
      await syncAssetPrivacyFromManualTags(transaction, ownerId, undefined, this.libraryMode);
    });
    return { tagIds };
  }
}
