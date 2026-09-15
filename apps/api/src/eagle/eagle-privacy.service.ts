import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface EaglePrivacySettings {
  tagIds: string[];
}

export async function lockOwnerPrivacyProjection(
  transaction: Prisma.TransactionClient,
  ownerId: string,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`sekereagle:privacy:${ownerId}`}, 0)
    )::text AS "lockResult"
  `);
}

export async function syncAssetPrivacyFromManualTags(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  assetIds?: string[],
): Promise<number> {
  await lockOwnerPrivacyProjection(transaction, ownerId);
  const assetScope = assetIds ? { id: { in: assetIds } } : {};
  const madePublic = await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      ...assetScope,
      isPrivate: true,
      manualTagLinks: { none: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: false, rowVersion: { increment: 1 } },
  });
  const madePrivate = await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
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
      await lockOwnerPrivacyProjection(transaction, ownerId);
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
        const marked = await transaction.eagleManualTag.updateMany({
          where: { ownerId, id: { in: tagIds } },
          data: { marksAssetsPrivate: true },
        });
        if (marked.count !== tagIds.length) {
          throw new NotFoundException('一个或多个标签不存在。');
        }
      }
      await syncAssetPrivacyFromManualTags(transaction, ownerId);
    });
    return { tagIds };
  }
}
