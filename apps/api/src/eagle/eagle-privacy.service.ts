import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface EaglePrivacySettings {
  tagIds: string[];
}

export async function syncAssetPrivacyFromManualTags(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  assetIds?: string[],
): Promise<void> {
  const assetScope = assetIds ? { id: { in: assetIds } } : {};
  await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      ...assetScope,
      isPrivate: true,
      manualTagLinks: { none: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: false, rowVersion: { increment: 1 } },
  });
  await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      ...assetScope,
      isPrivate: false,
      manualTagLinks: { some: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: true, rowVersion: { increment: 1 } },
  });
}

@Injectable()
export class EaglePrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(ownerId: string): Promise<EaglePrivacySettings> {
    const tags = await this.prisma.eagleManualTag.findMany({
      where: { ownerId, marksAssetsPrivate: true },
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
      const ownedTagCount = await transaction.eagleManualTag.count({
        where: { ownerId, id: { in: tagIds } },
      });
      if (ownedTagCount !== tagIds.length) {
        throw new NotFoundException('一个或多个标签不存在。');
      }
      await transaction.eagleManualTag.updateMany({
        where: {
          ownerId,
          marksAssetsPrivate: true,
          ...(tagIds.length ? { id: { notIn: tagIds } } : {}),
        },
        data: { marksAssetsPrivate: false },
      });
      if (tagIds.length) {
        await transaction.eagleManualTag.updateMany({
          where: { ownerId, id: { in: tagIds } },
          data: { marksAssetsPrivate: true },
        });
      }
      await syncAssetPrivacyFromManualTags(transaction, ownerId);
    });
    return { tagIds };
  }
}
