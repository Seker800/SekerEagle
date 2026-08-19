import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '@sekereagle/config';

const DEFAULT_MAX_ASSET_COUNT = 5;
const LEGACY_PROVIDER = 'sekereagle-one-time-maintenance';
const LEGACY_MODEL = 'historical-imported-ai-tags';
const LEGACY_PROMPT_VERSION = 'reclassify-small-imported-manual-tags-v1';

type CandidateSource = {
  id: string;
  name: string;
  normalizedName: string;
  isStarred: boolean;
  groupId: string | null;
  semanticConfig: { tagId: string } | null;
  assetLinks: Array<{
    assignedByUser: boolean;
    asset: { id: string; mediaRevision: number; deletedAt: Date | null };
  }>;
};

export type ReclassificationCandidate = {
  id: string;
  name: string;
  normalizedName: string;
  activeAssetCount: number;
  totalAssetCount: number;
  assetLinks: CandidateSource['assetLinks'];
};

type SkipCounts = {
  unused: number;
  aboveThreshold: number;
  userAssigned: number;
  manuallyOrganized: number;
  semanticConfigured: number;
};

export function selectReclassificationCandidates(
  tags: CandidateSource[],
  maxAssetCount = DEFAULT_MAX_ASSET_COUNT,
): { candidates: ReclassificationCandidate[]; skipped: Record<string, number> } {
  const skipped: SkipCounts = {
    unused: 0,
    aboveThreshold: 0,
    userAssigned: 0,
    manuallyOrganized: 0,
    semanticConfigured: 0,
  };
  const candidates: ReclassificationCandidate[] = [];

  for (const tag of tags) {
    const activeAssetCount = tag.assetLinks.filter(({ asset }) => !asset.deletedAt).length;
    if (activeAssetCount === 0) {
      skipped.unused += 1;
      continue;
    }
    if (activeAssetCount > maxAssetCount) {
      skipped.aboveThreshold += 1;
      continue;
    }
    if (tag.assetLinks.some(({ assignedByUser }) => assignedByUser)) {
      skipped.userAssigned += 1;
      continue;
    }
    if (tag.isStarred || tag.groupId) {
      skipped.manuallyOrganized += 1;
      continue;
    }
    if (tag.semanticConfig) {
      skipped.semanticConfigured += 1;
      continue;
    }
    candidates.push({
      id: tag.id,
      name: tag.name,
      normalizedName: tag.normalizedName,
      activeAssetCount,
      totalAssetCount: tag.assetLinks.length,
      assetLinks: tag.assetLinks,
    });
  }

  return { candidates, skipped };
}

type CliOptions = {
  ownerEmail: string;
  maxAssetCount: number;
  apply: boolean;
  confirmedTagCount: number | null;
};

export function parseReclassificationArgs(args: string[]): CliOptions {
  let ownerEmail = '';
  let maxAssetCount = DEFAULT_MAX_ASSET_COUNT;
  let apply = false;
  let confirmedTagCount: number | null = null;
  for (const arg of args) {
    if (arg === '--apply') apply = true;
    else if (arg.startsWith('--owner-email='))
      ownerEmail = arg.slice('--owner-email='.length).trim().toLowerCase();
    else if (arg.startsWith('--max-assets=')) {
      maxAssetCount = Number(arg.slice('--max-assets='.length));
    } else if (arg.startsWith('--confirm-tag-count=')) {
      confirmedTagCount = Number(arg.slice('--confirm-tag-count='.length));
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!ownerEmail) throw new Error('必须提供 --owner-email=<账号邮箱>');
  if (!Number.isInteger(maxAssetCount) || maxAssetCount < 1 || maxAssetCount > 100) {
    throw new Error('--max-assets 必须是 1 到 100 的整数');
  }
  if (
    confirmedTagCount !== null &&
    (!Number.isInteger(confirmedTagCount) || confirmedTagCount < 0)
  ) {
    throw new Error('--confirm-tag-count 必须是非负整数');
  }
  if (apply && confirmedTagCount === null) {
    throw new Error('--apply 必须同时提供 dry-run 输出的 --confirm-tag-count=<候选标签数>');
  }
  return { ownerEmail, maxAssetCount, apply, confirmedTagCount };
}

async function loadCandidateSources(
  prisma: PrismaClient | Prisma.TransactionClient,
  ownerId: string,
): Promise<CandidateSource[]> {
  const tags = await prisma.eagleManualTag.findMany({
    where: { ownerId },
    orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      normalizedName: true,
      isStarred: true,
      groupId: true,
      semanticConfig: { select: { tagId: true } },
    },
  });
  const links = await prisma.$queryRaw<
    Array<{
      tagId: string;
      assignedByUser: boolean;
      assetId: string;
      mediaRevision: number;
      deletedAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT link."tagId", link."assignedByUser", asset.id AS "assetId",
           asset."mediaRevision", asset."deletedAt"
    FROM "EagleAssetManualTag" AS link
    JOIN "EagleAsset" AS asset
      ON asset."ownerId" = link."ownerId" AND asset.id = link."assetId"
    WHERE link."ownerId" = ${ownerId}
    ORDER BY link."tagId", link."assetId"
  `);
  const linksByTagId = new Map<string, CandidateSource['assetLinks']>();
  for (const { tagId, assignedByUser, assetId, mediaRevision, deletedAt } of links) {
    const tagLinks = linksByTagId.get(tagId) ?? [];
    tagLinks.push({
      assignedByUser,
      asset: { id: assetId, mediaRevision, deletedAt },
    });
    linksByTagId.set(tagId, tagLinks);
  }
  return tags.map((tag) => ({
    ...tag,
    assetLinks: linksByTagId.get(tag.id) ?? [],
  }));
}

export function migrateSmartFolderQuery(
  query: Prisma.JsonValue,
  manualToAiTagId: ReadonlyMap<string, string>,
): Prisma.InputJsonValue {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new Error('智能文件夹条件不是受支持的对象结构');
  }
  const root = structuredClone(query) as Record<string, unknown>;
  const filters = root.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error('智能文件夹条件缺少 filters');
  }
  const record = filters as Record<string, unknown>;
  const manualTagIds = Array.isArray(record.manualTagIds) ? record.manualTagIds : [];
  const aiTagIds = Array.isArray(record.aiTagIds) ? record.aiTagIds : [];
  if (
    manualTagIds.some((id) => typeof id !== 'string') ||
    aiTagIds.some((id) => typeof id !== 'string')
  ) {
    throw new Error('智能文件夹标签条件包含非字符串 ID');
  }
  record.manualTagIds = manualTagIds.filter((id) => !manualToAiTagId.has(id as string));
  record.aiTagIds = [
    ...new Set([
      ...(aiTagIds as string[]),
      ...(manualTagIds as string[]).flatMap((id) => {
        const aiTagId = manualToAiTagId.get(id);
        return aiTagId ? [aiTagId] : [];
      }),
    ]),
  ];
  return root as Prisma.InputJsonValue;
}

async function run() {
  assertSafeRuntimeTarget({
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3Endpoint: process.env.S3_ENDPOINT ?? '',
    s3Bucket: process.env.S3_BUCKET ?? '',
  });
  const options = parseReclassificationArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const owner = await prisma.user.findUnique({
      where: { email: options.ownerEmail },
      select: { id: true, email: true },
    });
    if (!owner) throw new Error(`账号不存在: ${options.ownerEmail}`);

    const selection = selectReclassificationCandidates(
      await loadCandidateSources(prisma, owner.id),
      options.maxAssetCount,
    );
    const candidateAssetIds = new Set(
      selection.candidates.flatMap((tag) => tag.assetLinks.map(({ asset }) => asset.id)),
    );
    const preview = {
      mode: options.apply ? 'apply' : 'dry-run',
      ownerEmail: owner.email,
      maxAssetCount: options.maxAssetCount,
      candidateTagCount: selection.candidates.length,
      affectedAssetCount: candidateAssetIds.size,
      candidateLinkCount: selection.candidates.reduce((sum, tag) => sum + tag.totalAssetCount, 0),
      skipped: selection.skipped,
      sample: selection.candidates.slice(0, 30).map(({ name, activeAssetCount }) => ({
        name,
        activeAssetCount,
      })),
    };
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    if (!options.apply || selection.candidates.length === 0) return;
    if (options.confirmedTagCount !== selection.candidates.length) {
      throw new Error(
        `候选标签数为 ${selection.candidates.length}，与确认值 ${options.confirmedTagCount} 不一致；请重新 dry-run`,
      );
    }

    const result = await prisma.$transaction(
      async (transaction) => {
        const currentSelection = selectReclassificationCandidates(
          await loadCandidateSources(transaction, owner.id),
          options.maxAssetCount,
        );
        const expectedIds = selection.candidates.map(({ id }) => id).sort();
        const currentIds = currentSelection.candidates.map(({ id }) => id).sort();
        if (JSON.stringify(expectedIds) !== JSON.stringify(currentIds)) {
          throw new Error('预览后候选标签发生变化，已取消迁移；请重新执行 dry-run');
        }

        const existingAiTags = await transaction.eagleAiTag.findMany({
          where: {
            ownerId: owner.id,
            normalizedName: {
              in: selection.candidates.map(({ normalizedName }) => normalizedName),
            },
          },
          select: { id: true, normalizedName: true },
        });
        const aiTagIdByName = new Map(
          existingAiTags.map(({ id, normalizedName }) => [normalizedName, id]),
        );
        const newAiTags = selection.candidates
          .filter(({ normalizedName }) => !aiTagIdByName.has(normalizedName))
          .map(({ name, normalizedName }) => ({
            id: randomUUID(),
            ownerId: owner.id,
            name,
            normalizedName,
          }));
        if (newAiTags.length) await transaction.eagleAiTag.createMany({ data: newAiTags });
        for (const tag of newAiTags) aiTagIdByName.set(tag.normalizedName, tag.id);
        const manualToAiTagId = new Map(
          selection.candidates.map(({ id, normalizedName }) => [
            id,
            aiTagIdByName.get(normalizedName)!,
          ]),
        );

        const desiredLinks = selection.candidates.flatMap((tag) =>
          tag.assetLinks.map(({ asset }) => ({
            assetId: asset.id,
            assetRevision: asset.mediaRevision,
            aiTagId: manualToAiTagId.get(tag.id)!,
          })),
        );
        const existingLinks = await transaction.eagleAssetAiTag.findMany({
          where: {
            ownerId: owner.id,
            status: 'ACTIVE',
            assetId: { in: [...new Set(desiredLinks.map(({ assetId }) => assetId))] },
            aiTagId: { in: [...new Set(desiredLinks.map(({ aiTagId }) => aiTagId))] },
          },
          select: { assetId: true, aiTagId: true },
        });
        const existingLinkKeys = new Set(
          existingLinks.map((link) => `${link.assetId}:${link.aiTagId}`),
        );
        const missingLinks = desiredLinks.filter(
          (link) => !existingLinkKeys.has(`${link.assetId}:${link.aiTagId}`),
        );
        const linksByAsset = new Map<string, typeof missingLinks>();
        for (const link of missingLinks) {
          const links = linksByAsset.get(link.assetId) ?? [];
          links.push(link);
          linksByAsset.set(link.assetId, links);
        }
        const analysisRuns = [...linksByAsset.entries()].map(([assetId, links]) => ({
          id: randomUUID(),
          ownerId: owner.id,
          assetId,
          assetRevision: links[0]!.assetRevision,
          provider: LEGACY_PROVIDER,
          model: LEGACY_MODEL,
          promptVersion: LEGACY_PROMPT_VERSION,
          status: 'SUCCEEDED' as const,
          startedAt: new Date(),
          completedAt: new Date(),
        }));
        if (analysisRuns.length)
          await transaction.eagleAiAnalysisRun.createMany({ data: analysisRuns });
        const runIdByAsset = new Map(analysisRuns.map(({ assetId, id }) => [assetId, id]));
        if (missingLinks.length) {
          await transaction.eagleAssetAiTag.createMany({
            data: missingLinks.map(({ assetId, aiTagId }) => ({
              ownerId: owner.id,
              assetId,
              aiTagId,
              analysisRunId: runIdByAsset.get(assetId)!,
              confidence: 1,
              status: 'ACTIVE' as const,
            })),
          });
        }

        const smartFolders = await transaction.eagleSmartFolder.findMany({
          where: {
            ownerId: owner.id,
            manualTagDeps: { some: { manualTagId: { in: expectedIds } } },
          },
          select: { id: true, queryJson: true },
        });
        for (const folder of smartFolders) {
          await transaction.eagleSmartFolder.update({
            where: { ownerId_id: { ownerId: owner.id, id: folder.id } },
            data: {
              queryJson: migrateSmartFolderQuery(folder.queryJson, manualToAiTagId),
              rowVersion: { increment: 1 },
            },
          });
        }
        await transaction.eagleSmartFolderManualTagDependency.deleteMany({
          where: { ownerId: owner.id, manualTagId: { in: expectedIds } },
        });
        for (const folder of smartFolders) {
          const query = migrateSmartFolderQuery(folder.queryJson, manualToAiTagId) as {
            filters: { aiTagIds?: string[] };
          };
          await transaction.eagleSmartFolderAiTagDependency.createMany({
            data: (query.filters.aiTagIds ?? []).map((aiTagId) => ({
              ownerId: owner.id,
              smartFolderId: folder.id,
              aiTagId,
            })),
            skipDuplicates: true,
          });
        }

        const deleted = await transaction.eagleManualTag.deleteMany({
          where: { ownerId: owner.id, id: { in: expectedIds } },
        });
        if (deleted.count !== expectedIds.length) throw new Error('人工标签删除数量与预期不一致');
        return {
          migratedTagCount: expectedIds.length,
          createdAiTagCount: newAiTags.length,
          createdAiLinkCount: missingLinks.length,
          reusedAiLinkCount: desiredLinks.length - missingLinks.length,
          affectedSmartFolderCount: smartFolders.length,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 120_000,
      },
    );
    process.stdout.write(`${JSON.stringify({ completed: true, ...result }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`一次性标签重分类失败: ${message}\n`);
    process.exitCode = 1;
  });
}
