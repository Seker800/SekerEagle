import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  EagleImportItemAction,
  EagleImportItemStatus,
  EagleImportRunStatus,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { SekerEagleIngestionPort } from '../../../seker-eagle-ingestion.port';
import {
  buildEagleImportCandidateTags,
  EAGLE_IMPORT_MANIFEST_VERSIONS,
  isSupportedEagleImportMedia,
  mapEagleImportItemMetadata,
  validateEagleImportManifestChunk,
  type EagleImportManifestChunkInput,
} from '../../eagle-app-import-manifest';
import type { CreateEagleImportRunInput } from '../../eagle-app-import.repository';
import {
  canPreflightEagleImport,
  canStageEagleImportManifest,
  resolveEagleImportAction,
} from '../../eagle-app-import-policy';
import {
  MAPPED_ITEM_SELECT,
  RUN_SELECT,
  type ImportPreflightSummary,
  type ImportRunProjection,
  applyImportMetadataBatch,
  assertDefinitionsUnchanged,
  assertMatchingRunDeclaration,
  buildMetadataHash,
  cleanName,
  cleanOptional,
  countItemStatuses,
  counterIncrements,
  decodeRunCursor,
  encodeRunCursor,
  hashRunDeclaration,
  hashValue,
  isPrismaUniqueConstraintError,
  lockImportRun,
  markImportMetadataItemsImported,
  normalizeIdentity,
  recordSourceObservations,
  requireStableDefinitions,
} from './import-repository-support';

const activePreflights = new Set<string>();

export class ImportRunRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: SekerEagleIngestionPort<Prisma.TransactionClient>,
  ) {}

  async createRun(ownerId: string, input: CreateEagleImportRunInput) {
    if (!EAGLE_IMPORT_MANIFEST_VERSIONS.includes(input.manifestVersion as 1 | 2)) {
      throw new BadRequestException('不支持的 Eagle 导入清单版本。');
    }
    const declarationHash = hashRunDeclaration(input);
    const existingBeforeLibraryMutation = await this.prisma.eagleImportRun.findUnique({
      where: {
        ownerId_libraryMode_idempotencyKey: {
          libraryMode: 'MATERIAL',
          ownerId,
          idempotencyKey: input.idempotencyKey,
        },
        libraryMode: 'MATERIAL',
      },
      select: RUN_SELECT,
    });
    if (existingBeforeLibraryMutation) {
      if (
        existingBeforeLibraryMutation.externalLibrary.externalLibraryId !== input.externalLibraryId
      ) {
        throw new ConflictException('该幂等键已用于另一份 Eagle 导入声明。');
      }
      assertMatchingRunDeclaration(
        existingBeforeLibraryMutation,
        existingBeforeLibraryMutation.externalLibraryId,
        input,
        declarationHash,
      );
      return this.serializeRun(existingBeforeLibraryMutation);
    }
    let resolvedLibraryId: string | null = null;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const library = await transaction.eagleExternalLibrary.upsert({
          where: {
            ownerId_libraryMode_provider_externalLibraryId: {
              libraryMode: 'MATERIAL',
              ownerId,
              provider: 'EAGLE_APP',
              externalLibraryId: input.externalLibraryId,
            },
            libraryMode: 'MATERIAL',
          },
          update: {
            displayName: input.libraryName,
            sourceModifiedAt: input.sourceModifiedAt,
          },
          create: {
            ownerId,
            provider: 'EAGLE_APP',
            externalLibraryId: input.externalLibraryId,
            displayName: input.libraryName,
            sourceModifiedAt: input.sourceModifiedAt,
            libraryMode: 'MATERIAL',
          },
          select: { id: true },
        });
        resolvedLibraryId = library.id;
        const existing = await transaction.eagleImportRun.findUnique({
          where: {
            ownerId_libraryMode_idempotencyKey: {
              libraryMode: 'MATERIAL',
              ownerId,
              idempotencyKey: input.idempotencyKey,
            },
            libraryMode: 'MATERIAL',
          },
          select: RUN_SELECT,
        });
        if (existing) {
          assertMatchingRunDeclaration(existing, library.id, input, declarationHash);
          return this.serializeRun(existing);
        }
        const created = await transaction.eagleImportRun.create({
          data: {
            ownerId,
            externalLibraryId: library.id,
            idempotencyKey: input.idempotencyKey,
            declarationHash,
            manifestVersion: input.manifestVersion,
            declaredItemCount: input.declaredItemCount,
            declaredByteSize: BigInt(input.declaredByteSize),
            libraryMode: 'MATERIAL',
          },
          select: RUN_SELECT,
        });
        return this.serializeRun(created);
      });
    } catch (error) {
      if (!resolvedLibraryId || !isPrismaUniqueConstraintError(error)) throw error;
      const replay = await this.prisma.eagleImportRun.findUnique({
        where: {
          ownerId_libraryMode_idempotencyKey: {
            libraryMode: 'MATERIAL',
            ownerId,
            idempotencyKey: input.idempotencyKey,
          },
          libraryMode: 'MATERIAL',
        },
        select: RUN_SELECT,
      });
      if (!replay) throw error;
      assertMatchingRunDeclaration(replay, resolvedLibraryId, input, declarationHash);
      return this.serializeRun(replay);
    }
  }

  async stageManifestChunk(ownerId: string, runId: string, input: EagleImportManifestChunkInput) {
    const validation = validateEagleImportManifestChunk(input);
    const contentHash = hashValue(input);
    return this.prisma.$transaction(async (transaction) => {
      await lockImportRun(transaction, ownerId, runId);
      const run = await transaction.eagleImportRun.findFirst({
        where: { id: runId, ownerId, libraryMode: 'MATERIAL' },
        select: { id: true, externalLibraryId: true, status: true, createdAt: true },
      });
      if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
      if (!canStageEagleImportManifest(run.status)) {
        throw new ConflictException('Eagle 导入任务已经完成清单阶段。');
      }

      const existingChunk = await transaction.eagleImportManifestChunk.findUnique({
        where: { runId_chunkKey: { runId, chunkKey: input.chunkKey }, libraryMode: 'MATERIAL' },
      });
      if (existingChunk) {
        if (existingChunk.contentHash !== contentHash) {
          throw new ConflictException('同一清单分块键不能提交不同内容。');
        }
        return {
          chunkKey: existingChunk.chunkKey,
          acceptedItemCount: existingChunk.acceptedItemCount,
          skippedItemCount: existingChunk.skippedItemCount,
          replayed: true,
        };
      }

      const folderDefinitions = input.folders.map((folder) => ({
        ownerId,
        runId,
        sourceFolderId: folder.sourceId,
        name: cleanName(folder.name),
        parentSourceFolderId: folder.parentSourceId,
      }));
      const tagGroupDefinitions = input.tagGroups.map((group) => {
        const name = cleanName(group.name);
        return {
          ownerId,
          runId,
          sourceGroupId: group.sourceId,
          name,
          normalizedName: normalizeIdentity(name),
          color: group.color ?? null,
          description: cleanOptional(group.description),
        };
      });
      const tagDefinitions = input.tags.map((tag) => {
        const name = cleanName(tag.name);
        return {
          ownerId,
          runId,
          name,
          normalizedName: normalizeIdentity(name),
          color: tag.color ?? null,
          isStarred: tag.isStarred ?? false,
          groupSourceIds: [...new Set(tag.groupSourceIds ?? [])].sort(),
        };
      });
      await this.stageStableDefinitions(transaction, runId, {
        folders: folderDefinitions,
        tagGroups: tagGroupDefinitions,
        tags: tagDefinitions,
      });

      const folders = await transaction.eagleImportFolderDefinition.findMany({
        where: { ownerId, runId, libraryMode: 'MATERIAL' },
        select: { sourceFolderId: true, name: true, parentSourceFolderId: true },
      });
      const folderInputs = folders.map((folder) => ({
        sourceId: folder.sourceFolderId,
        name: folder.name,
        parentSourceId: folder.parentSourceFolderId,
      }));

      const sourceItemIds = input.items.map((item) => item.sourceItemId);
      const priorItems = sourceItemIds.length
        ? await transaction.eagleImportRunItem.findMany({
            where: { runId, sourceItemId: { in: sourceItemIds }, libraryMode: 'MATERIAL' },
            select: { sourceItemId: true },
          })
        : [];
      if (priorItems.length) {
        throw new ConflictException(`Eagle 素材 ${priorItems[0]!.sourceItemId} 出现在多个分块中。`);
      }

      const preparedItems = input.items.map((item) => {
        const metadata = mapEagleImportItemMetadata(item, run.createdAt);
        const candidateTags = buildEagleImportCandidateTags({
          tagNames: item.tagNames,
          folderIds: item.folderIds,
          folders: folderInputs,
        });
        const metadataHash = buildMetadataHash(item, metadata, candidateTags.names);
        const skippedCode = item.isDeleted
          ? 'SOURCE_ITEM_DELETED'
          : isSupportedEagleImportMedia(item)
            ? null
            : 'UNSUPPORTED_MEDIA';
        return { item, metadata, candidateTags, metadataHash, skippedCode };
      });

      const existingExternalAssets = sourceItemIds.length
        ? await transaction.eagleExternalAsset.findMany({
            where: {
              ownerId,
              externalLibraryId: run.externalLibraryId,
              externalItemId: { in: sourceItemIds },
              libraryMode: 'MATERIAL',
            },
            select: {
              id: true,
              externalItemId: true,
              assetId: true,
              metadataHash: true,
              sourceContentSha256: true,
              asset: { select: { sha256: true } },
            },
          })
        : [];
      const existingExternalByItemId = new Map(
        existingExternalAssets.map((asset) => [asset.externalItemId, asset]),
      );
      const newExternalAssets = preparedItems
        .filter(({ item }) => !existingExternalByItemId.has(item.sourceItemId))
        .map(({ item }) => ({
          ownerId,
          externalLibraryId: run.externalLibraryId,
          externalItemId: item.sourceItemId,
        }));
      if (newExternalAssets.length) {
        await transaction.eagleExternalAsset.createMany({
          data: newExternalAssets.map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
        });
      }
      const externalAssets = sourceItemIds.length
        ? await transaction.eagleExternalAsset.findMany({
            where: {
              ownerId,
              externalLibraryId: run.externalLibraryId,
              externalItemId: { in: sourceItemIds },
              libraryMode: 'MATERIAL',
            },
            select: {
              id: true,
              externalItemId: true,
              assetId: true,
              metadataHash: true,
              sourceContentSha256: true,
              asset: { select: { sha256: true } },
            },
          })
        : [];
      const externalByItemId = new Map(
        externalAssets.map((asset) => [asset.externalItemId, asset]),
      );
      const completedAt = new Date();
      const runItems = preparedItems.map(
        ({ item, metadata, candidateTags, metadataHash, skippedCode }) => {
          const externalAsset = externalByItemId.get(item.sourceItemId);
          if (!externalAsset) throw new Error('Eagle 来源素材暂存失败。');
          const priorExternalAsset = existingExternalByItemId.get(item.sourceItemId);
          const knownContentSha256 =
            priorExternalAsset?.sourceContentSha256 ?? priorExternalAsset?.asset?.sha256 ?? null;
          const action = resolveEagleImportAction({
            manifestVersion: input.manifestVersion,
            skippedCode,
            hasMappedAsset: Boolean(externalAsset.assetId),
            priorMetadataHash: priorExternalAsset?.metadataHash ?? null,
            metadataHash,
            knownContentSha256,
            contentSha256: item.contentSha256 ?? null,
          });
          const status =
            action === EagleImportItemAction.SKIP_DELETED ||
            action === EagleImportItemAction.SKIP_UNSUPPORTED
              ? EagleImportItemStatus.SKIPPED
              : action === EagleImportItemAction.UNCHANGED
                ? EagleImportItemStatus.IMPORTED
                : EagleImportItemStatus.STAGED;
          return {
            ownerId,
            runId,
            externalAssetId: externalAsset.id,
            sourceItemId: item.sourceItemId,
            displayName: metadata.displayName,
            originalFileName: item.originalFileName,
            extension: item.extension.replace(/^\./, '').toLocaleLowerCase('en-US'),
            mimeType: item.mimeType.toLocaleLowerCase('en-US'),
            byteSize: BigInt(item.size),
            sourceImportedAt: metadata.libraryAddedAt,
            sourceModifiedAt: metadata.sourceModifiedAt,
            rating: metadata.rating,
            description: metadata.description,
            sourceUrl: metadata.sourceUrl,
            tagNames: candidateTags.names,
            folderSourceIds: [...new Set(item.folderIds)],
            metadataHash,
            action,
            contentSha256: item.contentSha256 ?? null,
            sourceFileModifiedAt: item.sourceFileModifiedAt
              ? new Date(item.sourceFileModifiedAt)
              : null,
            warningCodes: metadata.warnings,
            status,
            errorCode: skippedCode,
            assetId: externalAsset.assetId,
            terminalProgressAppliedAt:
              status === EagleImportItemStatus.IMPORTED || status === EagleImportItemStatus.SKIPPED
                ? completedAt
                : null,
            completedAt: status === EagleImportItemStatus.IMPORTED ? completedAt : null,
          };
        },
      );
      if (runItems.length) {
        await transaction.eagleImportRunItem.createMany({
          data: runItems.map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
        });
        await recordSourceObservations(
          transaction,
          runItems.map((item) => ({
            externalAssetId: item.externalAssetId,
            action: item.action,
            contentSha256: item.contentSha256,
            sourceFileModifiedAt: item.sourceFileModifiedAt,
            sourceByteSize: item.byteSize,
            metadataHash: item.metadataHash,
            observedAt: completedAt,
          })),
        );
      }

      const chunkCounts = countItemStatuses(runItems);
      await transaction.eagleImportRun.update({
        where: { id: runId, libraryMode: 'MATERIAL' },
        data: counterIncrements(chunkCounts),
      });
      await transaction.eagleImportManifestChunk.create({
        data: {
          ownerId,
          runId,
          chunkKey: input.chunkKey,
          contentHash,
          acceptedItemCount: validation.acceptedItemIds.length,
          skippedItemCount:
            validation.skippedDeletedItemIds.length + validation.skippedUnsupportedItemIds.length,
          libraryMode: 'MATERIAL',
        },
      });
      return {
        chunkKey: input.chunkKey,
        acceptedItemCount: validation.acceptedItemIds.length,
        skippedItemCount:
          validation.skippedDeletedItemIds.length + validation.skippedUnsupportedItemIds.length,
        replayed: false,
      };
    });
  }

  async preflight(ownerId: string, runId: string) {
    const preflightKey = `${ownerId}:${runId}`;
    if (activePreflights.has(preflightKey))
      throw new ConflictException('该导入任务的预检正在进行。');
    activePreflights.add(preflightKey);
    try {
      const initial = await this.prisma.eagleImportRun.findFirst({
        where: { id: runId, ownerId, libraryMode: 'MATERIAL' },
        select: {
          id: true,
          status: true,
          declaredItemCount: true,
          declaredByteSize: true,
        },
      });
      if (!initial) throw new NotFoundException('Eagle 导入任务不存在。');
      if (!canPreflightEagleImport(initial.status))
        throw new ConflictException('当前 Eagle 导入任务不能执行预检。');
      // Validate the declaration before any metadata page is allowed to commit.
      const [declaration] = await this.prisma.$queryRaw<
        Array<{ itemCount: bigint; byteSize: bigint; missingFolderIds: string[] }>
      >(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS "itemCount",
          COALESCE(SUM(item."byteSize"), 0)::bigint AS "byteSize",
          COALESCE((
            SELECT array_agg(DISTINCT folder_id ORDER BY folder_id)
            FROM "EagleImportRunItem" referenced_item
            CROSS JOIN LATERAL unnest(referenced_item."folderSourceIds") AS folder_id
            LEFT JOIN "EagleImportFolderDefinition" folder
              ON folder."ownerId" = referenced_item."ownerId"
             AND folder."runId" = referenced_item."runId"
             AND folder."sourceFolderId" = folder_id
            WHERE referenced_item."ownerId" = ${ownerId} AND referenced_item."libraryMode" = 'MATERIAL'::"LibraryMode"
              AND referenced_item."runId" = ${runId}
              AND folder."id" IS NULL
          ), ARRAY[]::text[]) AS "missingFolderIds"
        FROM "EagleImportRunItem" item
        WHERE item."ownerId" = ${ownerId} AND item."libraryMode" = 'MATERIAL'::"LibraryMode" AND item."runId" = ${runId}
      `);
      if (!declaration) throw new Error('Eagle 导入预检声明聚合未返回结果。');
      if (
        Number(declaration.itemCount) !== initial.declaredItemCount ||
        declaration.byteSize !== initial.declaredByteSize
      )
        throw new BadRequestException({
          code: 'MANIFEST_DECLARATION_MISMATCH',
          message: 'Eagle 清单数量或总字节数与导入声明不一致。',
          expected: {
            itemCount: initial.declaredItemCount,
            byteSize: Number(initial.declaredByteSize),
          },
          actual: {
            itemCount: Number(declaration.itemCount),
            byteSize: Number(declaration.byteSize),
          },
        });
      if (declaration.missingFolderIds.length)
        throw new BadRequestException({
          code: 'MISSING_FOLDER_DEFINITION',
          message: 'Eagle 清单引用了未声明的文件夹。',
          missingFolderIds: declaration.missingFolderIds,
        });
      // Metadata sync commits page by page; the final short transaction publishes the summary.
      await this.synchronizeMappedItems(ownerId, runId);
      return await this.prisma.$transaction(
        async (transaction) => {
          await lockImportRun(transaction, ownerId, runId);
          const run = await transaction.eagleImportRun.findFirst({
            where: { id: runId, ownerId, libraryMode: 'MATERIAL' },
            select: {
              id: true,
              status: true,
              declaredItemCount: true,
              declaredByteSize: true,
            },
          });
          if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
          if (!canPreflightEagleImport(run.status)) {
            throw new ConflictException('当前 Eagle 导入任务不能执行预检。');
          }
          const [summary] = await transaction.$queryRaw<ImportPreflightSummary[]>(
            Prisma.sql`
            SELECT
              COUNT(*)::bigint AS "itemCount",
              COALESCE(SUM(item."byteSize"), 0)::bigint AS "byteSize",
              COUNT(*) FILTER (WHERE item."status" = 'STAGED')::bigint AS "readyItemCount",
              COUNT(*) FILTER (WHERE item."status" = 'IMPORTED')::bigint AS "alreadyImportedItemCount",
              COUNT(*) FILTER (WHERE item."errorCode" = 'SOURCE_ITEM_DELETED')::bigint AS "skippedDeletedItemCount",
              COUNT(*) FILTER (WHERE item."errorCode" = 'UNSUPPORTED_MEDIA')::bigint AS "skippedUnsupportedItemCount",
              COALESCE(SUM(cardinality(item."warningCodes")), 0)::bigint AS "warningCount",
              COUNT(*) FILTER (WHERE item."action" = 'NEW')::bigint AS "newItemCount",
              COUNT(*) FILTER (WHERE item."action" = 'UNCHANGED')::bigint AS "unchangedItemCount",
              COUNT(*) FILTER (WHERE item."action" = 'METADATA_UPDATE')::bigint AS "metadataUpdateItemCount",
              COUNT(*) FILTER (WHERE item."action" = 'CONTENT_REPLACE')::bigint AS "contentReplaceItemCount",
              COUNT(*) FILTER (WHERE item."action" IN ('NEW', 'CONTENT_REPLACE'))::bigint AS "uploadItemCount",
              COALESCE(SUM(item."byteSize") FILTER (WHERE item."action" IN ('NEW', 'CONTENT_REPLACE')), 0)::bigint AS "uploadByteSize",
              COALESCE((
                SELECT array_agg(DISTINCT folder_id ORDER BY folder_id)
                FROM "EagleImportRunItem" referenced_item
                CROSS JOIN LATERAL unnest(referenced_item."folderSourceIds") AS folder_id
                LEFT JOIN "EagleImportFolderDefinition" folder
                  ON folder."ownerId" = referenced_item."ownerId"
                 AND folder."runId" = referenced_item."runId"
                 AND folder."sourceFolderId" = folder_id
                WHERE referenced_item."ownerId" = ${ownerId} AND referenced_item."libraryMode" = 'MATERIAL'::"LibraryMode"
                  AND referenced_item."runId" = ${runId}
                  AND folder."id" IS NULL
              ), ARRAY[]::text[]) AS "missingFolderIds"
            FROM "EagleImportRunItem" item
            WHERE item."ownerId" = ${ownerId} AND item."libraryMode" = 'MATERIAL'::"LibraryMode" AND item."runId" = ${runId}
          `,
          );
          if (!summary) throw new Error('Eagle 导入预检聚合未返回结果。');
          const actualItemCount = Number(summary.itemCount);
          if (
            actualItemCount !== run.declaredItemCount ||
            summary.byteSize !== run.declaredByteSize
          ) {
            throw new BadRequestException({
              code: 'MANIFEST_DECLARATION_MISMATCH',
              message: 'Eagle 清单数量或总字节数与导入声明不一致。',
              expected: {
                itemCount: run.declaredItemCount,
                byteSize: Number(run.declaredByteSize),
              },
              actual: { itemCount: actualItemCount, byteSize: Number(summary.byteSize) },
            });
          }
          if (summary.missingFolderIds.length) {
            throw new BadRequestException({
              code: 'MISSING_FOLDER_DEFINITION',
              message: 'Eagle 清单引用了未声明的文件夹。',
              missingFolderIds: summary.missingFolderIds,
            });
          }

          const readyItemCount = Number(summary.readyItemCount);
          const nextStatus =
            readyItemCount === 0
              ? EagleImportRunStatus.COMPLETED
              : EagleImportRunStatus.PREFLIGHTED;
          await transaction.eagleImportRun.update({
            where: { id: runId, libraryMode: 'MATERIAL' },
            data: {
              stagedItemCount: readyItemCount,
              importedItemCount: Number(summary.alreadyImportedItemCount),
              skippedItemCount:
                Number(summary.skippedDeletedItemCount) +
                Number(summary.skippedUnsupportedItemCount),
              failedItemCount: 0,
              status: nextStatus,
              completedAt: nextStatus === EagleImportRunStatus.COMPLETED ? new Date() : null,
            },
          });
          return {
            runId,
            status: nextStatus,
            itemCount: actualItemCount,
            byteSize: Number(summary.byteSize),
            readyItemCount,
            alreadyImportedItemCount: Number(summary.alreadyImportedItemCount),
            skippedDeletedItemCount: Number(summary.skippedDeletedItemCount),
            skippedUnsupportedItemCount: Number(summary.skippedUnsupportedItemCount),
            warningCount: Number(summary.warningCount),
            newItemCount: Number(summary.newItemCount),
            unchangedItemCount: Number(summary.unchangedItemCount),
            metadataUpdateItemCount: Number(summary.metadataUpdateItemCount),
            contentReplaceItemCount: Number(summary.contentReplaceItemCount),
            uploadItemCount: Number(summary.uploadItemCount),
            uploadByteSize: Number(summary.uploadByteSize),
          };
        },
        { timeout: 120_000 },
      );
    } finally {
      activePreflights.delete(preflightKey);
    }
  }

  async getRun(ownerId: string, runId: string) {
    const run = await this.prisma.eagleImportRun.findFirst({
      where: { id: runId, ownerId, libraryMode: 'MATERIAL' },
      select: RUN_SELECT,
    });
    if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
    return this.serializeRun(run);
  }

  async listRuns(
    ownerId: string,
    input: { externalLibraryId?: string; status?: string; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const cursor = input.cursor ? decodeRunCursor(input.cursor) : null;
    const rows = await this.prisma.eagleImportRun.findMany({
      where: {
        ownerId,
        ...(input.externalLibraryId
          ? { externalLibrary: { externalLibraryId: input.externalLibraryId } }
          : {}),
        ...(input.status ? { status: input.status as EagleImportRunStatus } : {}),
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: cursor.updatedAt } },
                { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
        libraryMode: 'MATERIAL',
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: RUN_SELECT,
    });
    const page = rows.slice(0, limit);
    return {
      runs: page.map((run) => this.serializeRun(run)),
      nextCursor:
        rows.length > limit && page.length
          ? encodeRunCursor(page.at(-1)!.updatedAt, page.at(-1)!.id)
          : null,
    };
  }

  async listLibraries(ownerId: string) {
    const libraries = await this.prisma.$queryRaw<
      Array<{
        externalLibraryId: string;
        displayName: string;
        sourceModifiedAt: Date | null;
        assetCount: bigint;
        lastImportedAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        library."externalLibraryId",
        library."displayName",
        library."sourceModifiedAt",
        COUNT(external."assetId")::bigint AS "assetCount",
        MAX(external."lastImportedAt") AS "lastImportedAt"
      FROM "EagleExternalLibrary" library
      LEFT JOIN "EagleExternalAsset" external
        ON external."ownerId" = library."ownerId"
       AND external."externalLibraryId" = library."id"
       AND external."assetId" IS NOT NULL
      WHERE library."ownerId" = ${ownerId} AND library."libraryMode" = 'MATERIAL'::"LibraryMode"
      GROUP BY library."id"
      ORDER BY library."updatedAt" DESC, library."id" DESC
    `);
    return {
      libraries: libraries.map((library) => ({
        ...library,
        assetCount: Number(library.assetCount),
      })),
    };
  }

  async cancel(ownerId: string, runId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await lockImportRun(transaction, ownerId, runId);
      const run = await transaction.eagleImportRun.findFirst({
        where: { id: runId, ownerId, libraryMode: 'MATERIAL' },
        select: { id: true, status: true },
      });
      if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
      const terminalStatuses: EagleImportRunStatus[] = [
        EagleImportRunStatus.COMPLETED,
        EagleImportRunStatus.PARTIAL,
        EagleImportRunStatus.FAILED,
      ];
      if (terminalStatuses.includes(run.status)) {
        throw new ConflictException('已结束的 Eagle 导入任务不能取消。');
      }
      if (run.status !== EagleImportRunStatus.CANCELLED) {
        const cancelledAt = new Date();
        const cancelled = await transaction.eagleImportRunItem.updateMany({
          where: {
            ownerId,
            runId,
            status: EagleImportItemStatus.STAGED,
            libraryMode: 'MATERIAL',
          },
          data: { status: EagleImportItemStatus.CANCELLED, completedAt: cancelledAt },
        });
        await transaction.eagleImportRun.update({
          where: { id: runId, libraryMode: 'MATERIAL' },
          data: {
            ...(cancelled.count > 0 ? { stagedItemCount: { decrement: cancelled.count } } : {}),
            status: EagleImportRunStatus.CANCELLED,
            cancelledAt,
          },
        });
      }
      return { runId, status: EagleImportRunStatus.CANCELLED };
    });
  }

  private async stageStableDefinitions(
    transaction: Prisma.TransactionClient,
    runId: string,
    input: {
      folders: Prisma.EagleImportFolderDefinitionCreateManyInput[];
      tagGroups: Prisma.EagleImportTagGroupDefinitionCreateManyInput[];
      tags: Prisma.EagleImportTagDefinitionCreateManyInput[];
    },
  ) {
    const folders = requireStableDefinitions(
      input.folders,
      (definition) => definition.sourceFolderId,
      '文件夹',
    );
    const tagGroups = requireStableDefinitions(
      input.tagGroups,
      (definition) => definition.sourceGroupId,
      '标签组',
    );
    const tags = requireStableDefinitions(
      input.tags,
      (definition) => definition.normalizedName,
      '标签',
    );
    const [existingFolders, existingTagGroups, existingTags] = await Promise.all([
      folders.length
        ? transaction.eagleImportFolderDefinition.findMany({
            where: {
              runId,
              sourceFolderId: { in: folders.map((item) => item.sourceFolderId) },
              libraryMode: 'MATERIAL',
            },
            select: { sourceFolderId: true, name: true, parentSourceFolderId: true },
          })
        : [],
      tagGroups.length
        ? transaction.eagleImportTagGroupDefinition.findMany({
            where: {
              runId,
              sourceGroupId: { in: tagGroups.map((item) => item.sourceGroupId) },
              libraryMode: 'MATERIAL',
            },
            select: {
              sourceGroupId: true,
              name: true,
              normalizedName: true,
              color: true,
              description: true,
            },
          })
        : [],
      tags.length
        ? transaction.eagleImportTagDefinition.findMany({
            where: {
              runId,
              normalizedName: { in: tags.map((item) => item.normalizedName) },
              libraryMode: 'MATERIAL',
            },
            select: {
              name: true,
              normalizedName: true,
              color: true,
              isStarred: true,
              groupSourceIds: true,
            },
          })
        : [],
    ]);
    assertDefinitionsUnchanged(folders, existingFolders, (item) => item.sourceFolderId, '文件夹');
    assertDefinitionsUnchanged(
      tagGroups,
      existingTagGroups,
      (item) => item.sourceGroupId,
      '标签组',
    );
    assertDefinitionsUnchanged(tags, existingTags, (item) => item.normalizedName, '标签');
    await Promise.all([
      folders.length
        ? transaction.eagleImportFolderDefinition.createMany({
            data: folders.map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
            skipDuplicates: true,
          })
        : undefined,
      tagGroups.length
        ? transaction.eagleImportTagGroupDefinition.createMany({
            data: tagGroups.map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
            skipDuplicates: true,
          })
        : undefined,
      tags.length
        ? transaction.eagleImportTagDefinition.createMany({
            data: tags.map((row) => ({ ...row, libraryMode: 'MATERIAL' as const })),
            skipDuplicates: true,
          })
        : undefined,
    ]);
  }

  private async synchronizeMappedItems(ownerId: string, runId: string) {
    let cursorId: string | undefined;
    while (true) {
      const items = await this.prisma.eagleImportRunItem.findMany({
        where: {
          ownerId,
          runId,
          status: EagleImportItemStatus.STAGED,
          action: EagleImportItemAction.METADATA_UPDATE,
          assetId: { not: null },
          libraryMode: 'MATERIAL',
        },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: MAPPED_ITEM_SELECT,
      });
      if (!items.length) return;
      await this.prisma.$transaction(
        async (transaction) => {
          // Cancel takes the same run row lock, so a page either commits before the
          // cancellation or observes it before touching any asset.
          await lockImportRun(transaction, ownerId, runId);
          const run = await transaction.eagleImportRun.findFirst({
            where: { id: runId, ownerId, libraryMode: 'MATERIAL' },
            select: { status: true },
          });
          if (!run || run.status === EagleImportRunStatus.CANCELLED) return;
          const staged = await transaction.eagleImportRunItem.findMany({
            where: {
              id: { in: items.map((item) => item.id) },
              ownerId,
              runId,
              status: EagleImportItemStatus.STAGED,
              libraryMode: 'MATERIAL',
            },
            select: MAPPED_ITEM_SELECT,
          });
          if (!staged.length) return;
          await applyImportMetadataBatch(this.ingestion, transaction, ownerId, staged);
          const mapped = staged.filter(
            (item): item is (typeof staged)[number] & { assetId: string } => Boolean(item.assetId),
          );
          if (mapped.length) await markImportMetadataItemsImported(transaction, mapped);
        },
        { timeout: 60_000 },
      );
      cursorId = items.at(-1)!.id;
    }
  }

  private serializeRun(run: ImportRunProjection) {
    const {
      declarationHash: _declarationHash,
      externalLibrary,
      externalLibraryId: _internalLibraryId,
      ...view
    } = run;
    void _declarationHash;
    void _internalLibraryId;
    return {
      ...view,
      externalLibraryId: externalLibrary.externalLibraryId,
      declaredByteSize: Number(run.declaredByteSize),
    };
  }
}
