import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  SekerEagleIngestionCommand,
  SekerEagleIngestionPort,
  SekerEagleIngestionTag,
} from '../../seker-eagle-ingestion.port';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from '../../eagle-privacy.service';

type ResolvedDefinition = { id: string; normalizedName: string };

@Injectable()
export class PrismaSekerEagleIngestionAdapter implements SekerEagleIngestionPort<Prisma.TransactionClient> {
  async applyMetadata(
    command: SekerEagleIngestionCommand,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    await lockOwnerPrivacyProjection(transaction, command.ownerId);
    const previousOrigins = await transaction.eagleAssetManualTagIngestion.findMany({
      where: {
        ownerId: command.ownerId,
        assetId: command.assetId,
        sourceKey: command.sourceKey,
        libraryMode: 'MATERIAL',
      },
      select: { tagId: true },
    });
    const manualTagIds = await this.resolveManualTags(command, transaction);

    await transaction.eagleAsset.update({
      where: { ownerId: command.ownerId, id: command.assetId, libraryMode: 'MATERIAL' },
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
        where: {
          ownerId_assetId: { ownerId: command.ownerId, assetId: command.assetId },
          libraryMode: 'MATERIAL',
        },
        update: { description: command.description, sourceUrl: command.sourceUrl },
        create: {
          ownerId: command.ownerId,
          assetId: command.assetId,
          description: command.description,
          sourceUrl: command.sourceUrl,
          libraryMode: 'MATERIAL',
        },
      });
    } else {
      await transaction.eagleAssetAnnotation.updateMany({
        where: { ownerId: command.ownerId, assetId: command.assetId, libraryMode: 'MATERIAL' },
        data: { description: null, sourceUrl: null },
      });
    }
    if (manualTagIds.length) {
      await transaction.eagleAssetManualTag.createMany({
        data: manualTagIds
          .map((tagId) => ({
            ownerId: command.ownerId,
            assetId: command.assetId,
            tagId,
            assignedByUser: false,
            assignmentProvenance: 'EAGLE_IMPORTED',
          }))
          .map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
        skipDuplicates: true,
      });
      await transaction.eagleAssetManualTagIngestion.createMany({
        data: manualTagIds
          .map((tagId) => ({
            ownerId: command.ownerId,
            assetId: command.assetId,
            tagId,
            sourceKey: command.sourceKey,
          }))
          .map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
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
          libraryMode: 'MATERIAL',
        },
      });
      await transaction.eagleAssetManualTag.deleteMany({
        where: {
          ownerId: command.ownerId,
          assetId: command.assetId,
          tagId: { in: staleTagIds },
          assignedByUser: false,
          ingestionOrigins: { none: {} },
          libraryMode: 'MATERIAL',
        },
      });
    }
    await syncAssetPrivacy(transaction, command.ownerId, [command.assetId]);
  }

  async applyMetadataBatch(
    commands: readonly SekerEagleIngestionCommand[],
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    if (!commands.length) return;
    const ownerId = commands[0]!.ownerId;
    if (commands.some((command) => command.ownerId !== ownerId))
      throw new Error('Eagle 导入批次包含不同 owner。');
    await lockOwnerPrivacyProjection(transaction, ownerId);
    const uniqueCommands = [
      ...new Map(commands.map((command) => [command.assetId, command])).values(),
    ];
    const assetIds = uniqueCommands.map((command) => command.assetId);
    const sourceKeys = [...new Set(uniqueCommands.map((command) => command.sourceKey))];
    const previous = await transaction.eagleAssetManualTagIngestion.findMany({
      where: {
        ownerId,
        assetId: { in: assetIds },
        sourceKey: { in: sourceKeys },
        libraryMode: 'MATERIAL',
      },
      select: { assetId: true, tagId: true },
    });
    const previousByAsset = new Map<string, Set<string>>();
    for (const row of previous) {
      const existing = previousByAsset.get(row.assetId) ?? new Set<string>();
      existing.add(row.tagId);
      previousByAsset.set(row.assetId, existing);
    }

    const tagIdByName = await this.resolveManualTagBatch(
      ownerId,
      uniqueCommands.flatMap((command) => command.tags),
      transaction,
    );
    const tagIdsFor = (command: SekerEagleIngestionCommand) => [
      ...new Set(command.tags.map((tag) => tagIdByName.get(tag.normalizedName)!)),
    ];

    const assetRows = uniqueCommands.map(
      (command) =>
        Prisma.sql`(${command.assetId}::text, ${command.displayName}::text, ${normalizeDisplayName(command.displayName)}::text, ${command.rating}::int, ${command.libraryAddedAt}::timestamp(3))`,
    );
    const updated = await transaction.$executeRaw(Prisma.sql`
      UPDATE "EagleAsset" AS a
      SET "displayName" = v."displayName",
          "normalizedDisplayName" = v."normalizedName",
          "rating" = v."rating",
          "libraryAddedAt" = COALESCE(v."libraryAddedAt", a."libraryAddedAt"),
          "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(assetRows)}) AS v("id", "displayName", "normalizedName", "rating", "libraryAddedAt")
      WHERE a."ownerId" = ${ownerId} AND a."libraryMode" = 'MATERIAL'::"LibraryMode" AND a."id" = v."id"
    `);
    if (updated !== uniqueCommands.length) throw new Error('Eagle 导入素材批量更新不完整。');

    const annotated = uniqueCommands.filter((command) => command.description || command.sourceUrl);
    if (annotated.length) {
      const rows = annotated.map(
        (command) =>
          Prisma.sql`(${command.assetId}::text, ${command.description}::text, ${command.sourceUrl}::text)`,
      );
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "EagleAssetAnnotation" ("ownerId", "assetId", "description", "sourceUrl", "libraryMode", "createdAt", "updatedAt")
        SELECT ${ownerId}, v."assetId", v."description", v."sourceUrl", 'MATERIAL'::"LibraryMode", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(rows)}) AS v("assetId", "description", "sourceUrl")
        ON CONFLICT ("ownerId", "libraryMode", "assetId")
        DO UPDATE SET "description" = EXCLUDED."description", "sourceUrl" = EXCLUDED."sourceUrl", "updatedAt" = CURRENT_TIMESTAMP
      `);
    }
    const clearedAssetIds = uniqueCommands
      .filter((command) => !command.description && !command.sourceUrl)
      .map((command) => command.assetId);
    if (clearedAssetIds.length)
      await transaction.eagleAssetAnnotation.updateMany({
        where: { ownerId, assetId: { in: clearedAssetIds }, libraryMode: 'MATERIAL' },
        data: { description: null, sourceUrl: null },
      });

    const links = new Map<
      string,
      {
        ownerId: string;
        assetId: string;
        tagId: string;
        assignedByUser: false;
        assignmentProvenance: 'EAGLE_IMPORTED';
        libraryMode: 'MATERIAL';
      }
    >();
    const origins = new Map<
      string,
      {
        ownerId: string;
        assetId: string;
        tagId: string;
        sourceKey: string;
        libraryMode: 'MATERIAL';
      }
    >();
    for (const command of uniqueCommands)
      for (const tagId of tagIdsFor(command)) {
        links.set(`${command.assetId}:${tagId}`, {
          ownerId,
          assetId: command.assetId,
          tagId,
          assignedByUser: false,
          assignmentProvenance: 'EAGLE_IMPORTED',
          libraryMode: 'MATERIAL',
        });
        origins.set(`${command.assetId}:${tagId}`, {
          ownerId,
          assetId: command.assetId,
          tagId,
          sourceKey: command.sourceKey,
          libraryMode: 'MATERIAL',
        });
      }
    await createInBatches(transaction.eagleAssetManualTag, [...links.values()]);
    await createInBatches(transaction.eagleAssetManualTagIngestion, [...origins.values()]);

    const staleIngestion: Array<{ assetId: string; tagId: string; sourceKey: string }> = [];
    const staleLinks: Array<{ assetId: string; tagId: string }> = [];
    for (const command of uniqueCommands) {
      const current = new Set(tagIdsFor(command));
      for (const tagId of previousByAsset.get(command.assetId) ?? [])
        if (!current.has(tagId)) {
          staleIngestion.push({ assetId: command.assetId, tagId, sourceKey: command.sourceKey });
          staleLinks.push({ assetId: command.assetId, tagId });
        }
    }
    if (staleIngestion.length) {
      const rows = staleIngestion.map(
        (row) => Prisma.sql`(${row.assetId}::text, ${row.tagId}::text, ${row.sourceKey}::text)`,
      );
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "EagleAssetManualTagIngestion" i
        USING (VALUES ${Prisma.join(rows)}) AS s("assetId", "tagId", "sourceKey")
        WHERE i."ownerId" = ${ownerId} AND i."libraryMode" = 'MATERIAL'::"LibraryMode"
          AND i."assetId" = s."assetId" AND i."tagId" = s."tagId" AND i."sourceKey" = s."sourceKey"
      `);
    }
    if (staleLinks.length) {
      const rows = staleLinks.map((row) => Prisma.sql`(${row.assetId}::text, ${row.tagId}::text)`);
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "EagleAssetManualTag" t
        USING (VALUES ${Prisma.join(rows)}) AS s("assetId", "tagId")
        WHERE t."ownerId" = ${ownerId} AND t."libraryMode" = 'MATERIAL'::"LibraryMode"
          AND t."assetId" = s."assetId" AND t."tagId" = s."tagId"
          AND t."assignedByUser" = false
          AND NOT EXISTS (
            SELECT 1 FROM "EagleAssetManualTagIngestion" i
            WHERE i."ownerId" = t."ownerId" AND i."libraryMode" = t."libraryMode"
              AND i."assetId" = t."assetId" AND i."tagId" = t."tagId"
          )
      `);
    }
    await syncAssetPrivacy(transaction, ownerId, assetIds);
  }

  private async resolveManualTags(
    command: SekerEagleIngestionCommand,
    transaction: Prisma.TransactionClient,
  ): Promise<string[]> {
    const tagIdByName = await this.resolveManualTagBatch(
      command.ownerId,
      command.tags,
      transaction,
    );
    return command.tags.map((tag) => tagIdByName.get(tag.normalizedName)!);
  }

  private async resolveManualTagBatch(
    ownerId: string,
    tags: readonly SekerEagleIngestionTag[],
    transaction: Prisma.TransactionClient,
  ): Promise<Map<string, string>> {
    const candidates = uniqueByNormalizedName([...tags]);
    if (!candidates.length) return new Map();

    const existing = await transaction.eagleManualTag.findMany({
      where: {
        ownerId,
        normalizedName: { in: candidates.map(({ normalizedName }) => normalizedName) },
        libraryMode: 'MATERIAL',
      },
      select: { id: true, normalizedName: true },
    });
    const existingNames = new Set(existing.map(({ normalizedName }) => normalizedName));
    const newCandidates = candidates.filter(
      ({ normalizedName }) => !existingNames.has(normalizedName),
    );
    if (newCandidates.length) {
      await transaction.eagleManualTag.createMany({
        data: newCandidates
          .map((candidate) => ({
            ownerId,
            name: candidate.name,
            normalizedName: candidate.normalizedName,
            color: candidate.color,
            isStarred: candidate.isStarred,
          }))
          .map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
        skipDuplicates: true,
      });
    }

    const resolved = newCandidates.length
      ? await transaction.eagleManualTag.findMany({
          where: {
            ownerId,
            normalizedName: { in: candidates.map(({ normalizedName }) => normalizedName) },
            libraryMode: 'MATERIAL',
          },
          select: { id: true, normalizedName: true },
        })
      : existing;
    const tagByName = resolvedByName(resolved, candidates.length, '标签');
    await this.bindGroupsForNewTags(ownerId, newCandidates, tagByName, transaction);
    return new Map(
      candidates.map(({ normalizedName }) => [normalizedName, tagByName.get(normalizedName)!.id]),
    );
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
        libraryMode: 'MATERIAL',
      },
      select: { id: true, normalizedName: true },
    });
    const existingNames = new Set(existing.map(({ normalizedName }) => normalizedName));
    const missing = groupCandidates.filter(
      ({ normalizedName }) => !existingNames.has(normalizedName),
    );
    if (missing.length) {
      await transaction.eagleManualTagGroup.createMany({
        data: missing
          .map((group) => ({
            ownerId,
            name: group.name,
            normalizedName: group.normalizedName,
            color: group.color,
            description: group.description,
          }))
          .map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
        skipDuplicates: true,
      });
    }
    const resolved = missing.length
      ? await transaction.eagleManualTagGroup.findMany({
          where: {
            ownerId,
            normalizedName: { in: groupCandidates.map(({ normalizedName }) => normalizedName) },
            libraryMode: 'MATERIAL',
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
      data: memberships.map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
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
      WHERE tag."ownerId" = ${ownerId} AND tag."libraryMode" = 'MATERIAL'::"LibraryMode" AND tag."id" = mapping."tagId"
    `);
  }
}

function uniqueByNormalizedName<T extends { normalizedName: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.normalizedName, value])).values()];
}

function normalizeDisplayName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

async function createInBatches<T>(
  delegate: { createMany: (args: { data: T[]; skipDuplicates: true }) => Promise<unknown> },
  rows: T[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 500)
    await delegate.createMany({ data: rows.slice(offset, offset + 500), skipDuplicates: true });
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
