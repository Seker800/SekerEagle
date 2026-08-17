import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  SekerEagleIngestionCommand,
  SekerEagleIngestionPort,
  SekerEagleIngestionTag,
} from '../../seker-eagle-ingestion.port';

type ResolvedDefinition = { id: string; normalizedName: string };

@Injectable()
export class PrismaSekerEagleIngestionAdapter implements SekerEagleIngestionPort<Prisma.TransactionClient> {
  async applyMetadata(
    command: SekerEagleIngestionCommand,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const previousOrigins = await transaction.eagleAssetManualTagIngestion.findMany({
      where: {
        ownerId: command.ownerId,
        assetId: command.assetId,
        sourceKey: command.sourceKey,
      },
      select: { tagId: true },
    });
    const manualTagIds = await this.resolveManualTags(command, transaction);

    await transaction.eagleAsset.update({
      where: { id: command.assetId },
      data: {
        displayName: command.displayName,
        normalizedDisplayName: command.displayName
          .normalize('NFKC')
          .trim()
          .toLocaleLowerCase('zh-CN'),
        rating: command.rating,
        libraryAddedAt: command.libraryAddedAt ?? undefined,
      },
    });
    if (command.description || command.sourceUrl) {
      await transaction.eagleAssetAnnotation.upsert({
        where: { ownerId_assetId: { ownerId: command.ownerId, assetId: command.assetId } },
        update: { description: command.description, sourceUrl: command.sourceUrl },
        create: {
          ownerId: command.ownerId,
          assetId: command.assetId,
          description: command.description,
          sourceUrl: command.sourceUrl,
        },
      });
    } else {
      await transaction.eagleAssetAnnotation.updateMany({
        where: { ownerId: command.ownerId, assetId: command.assetId },
        data: { description: null, sourceUrl: null },
      });
    }
    if (manualTagIds.length) {
      await transaction.eagleAssetManualTag.createMany({
        data: manualTagIds.map((tagId) => ({
          ownerId: command.ownerId,
          assetId: command.assetId,
          tagId,
          assignedByUser: false,
        })),
        skipDuplicates: true,
      });
      await transaction.eagleAssetManualTagIngestion.createMany({
        data: manualTagIds.map((tagId) => ({
          ownerId: command.ownerId,
          assetId: command.assetId,
          tagId,
          sourceKey: command.sourceKey,
        })),
        skipDuplicates: true,
      });
    }

    const currentTagIds = new Set(manualTagIds);
    const staleTagIds = previousOrigins
      .map(({ tagId }) => tagId)
      .filter((tagId) => !currentTagIds.has(tagId));
    if (staleTagIds.length) {
      await transaction.eagleAssetManualTagIngestion.deleteMany({
        where: {
          ownerId: command.ownerId,
          assetId: command.assetId,
          sourceKey: command.sourceKey,
          tagId: { in: staleTagIds },
        },
      });
      await transaction.eagleAssetManualTag.deleteMany({
        where: {
          ownerId: command.ownerId,
          assetId: command.assetId,
          tagId: { in: staleTagIds },
          assignedByUser: false,
          ingestionOrigins: { none: {} },
        },
      });
    }
  }

  private async resolveManualTags(
    command: SekerEagleIngestionCommand,
    transaction: Prisma.TransactionClient,
  ): Promise<string[]> {
    const candidates = uniqueByNormalizedName(command.tags);
    if (!candidates.length) return [];

    const existing = await transaction.eagleManualTag.findMany({
      where: {
        ownerId: command.ownerId,
        normalizedName: { in: candidates.map(({ normalizedName }) => normalizedName) },
      },
      select: { id: true, normalizedName: true },
    });
    const existingNames = new Set(existing.map(({ normalizedName }) => normalizedName));
    const newCandidates = candidates.filter(
      ({ normalizedName }) => !existingNames.has(normalizedName),
    );
    if (newCandidates.length) {
      await transaction.eagleManualTag.createMany({
        data: newCandidates.map((candidate) => ({
          ownerId: command.ownerId,
          name: candidate.name,
          normalizedName: candidate.normalizedName,
          color: candidate.color,
          isStarred: candidate.isStarred,
        })),
        skipDuplicates: true,
      });
    }

    const resolved = newCandidates.length
      ? await transaction.eagleManualTag.findMany({
          where: {
            ownerId: command.ownerId,
            normalizedName: { in: candidates.map(({ normalizedName }) => normalizedName) },
          },
          select: { id: true, normalizedName: true },
        })
      : existing;
    const tagByName = resolvedByName(resolved, candidates.length, '标签');
    await this.bindGroupsForNewTags(command.ownerId, newCandidates, tagByName, transaction);
    return candidates.map(({ normalizedName }) => tagByName.get(normalizedName)!.id);
  }

  private async bindGroupsForNewTags(
    ownerId: string,
    newTags: SekerEagleIngestionTag[],
    tagByName: Map<string, ResolvedDefinition>,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const groupCandidates = uniqueByNormalizedName(newTags.flatMap(({ groups }) => groups));
    if (!groupCandidates.length) return;

    const existing = await transaction.eagleManualTagGroup.findMany({
      where: {
        ownerId,
        normalizedName: { in: groupCandidates.map(({ normalizedName }) => normalizedName) },
      },
      select: { id: true, normalizedName: true },
    });
    const existingNames = new Set(existing.map(({ normalizedName }) => normalizedName));
    const missing = groupCandidates.filter(
      ({ normalizedName }) => !existingNames.has(normalizedName),
    );
    if (missing.length) {
      await transaction.eagleManualTagGroup.createMany({
        data: missing.map((group) => ({
          ownerId,
          name: group.name,
          normalizedName: group.normalizedName,
          color: group.color,
          description: group.description,
        })),
        skipDuplicates: true,
      });
    }
    const resolved = missing.length
      ? await transaction.eagleManualTagGroup.findMany({
          where: {
            ownerId,
            normalizedName: { in: groupCandidates.map(({ normalizedName }) => normalizedName) },
          },
          select: { id: true, normalizedName: true },
        })
      : existing;
    const groupByName = resolvedByName(resolved, groupCandidates.length, '标签组');
    const memberships = newTags.flatMap((tag) =>
      uniqueByNormalizedName(tag.groups).map((group) => ({
        ownerId,
        tagId: tagByName.get(tag.normalizedName)!.id,
        groupId: groupByName.get(group.normalizedName)!.id,
      })),
    );
    if (!memberships.length) return;
    await transaction.eagleManualTagGroupMembership.createMany({
      data: memberships,
      skipDuplicates: true,
    });

    const primaryGroups = newTags
      .filter(({ groups }) => groups.length > 0)
      .map((tag) => ({
        tagId: tagByName.get(tag.normalizedName)!.id,
        groupId: groupByName.get(tag.groups[0]!.normalizedName)!.id,
      }));
    if (!primaryGroups.length) return;
    const rows = primaryGroups.map(({ tagId, groupId }) => Prisma.sql`(${tagId}, ${groupId})`);
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "EagleManualTag" AS tag
      SET "groupId" = mapping."groupId", "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(rows)}) AS mapping("tagId", "groupId")
      WHERE tag."ownerId" = ${ownerId} AND tag."id" = mapping."tagId"
    `);
  }
}

function uniqueByNormalizedName<T extends { normalizedName: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.normalizedName, value])).values()];
}

function resolvedByName(
  values: ResolvedDefinition[],
  expectedCount: number,
  definitionName: string,
): Map<string, ResolvedDefinition> {
  const byName = new Map(values.map((value) => [value.normalizedName, value]));
  if (byName.size !== expectedCount) {
    throw new Error(`${definitionName}批量解析不完整。`);
  }
  return byName;
}
