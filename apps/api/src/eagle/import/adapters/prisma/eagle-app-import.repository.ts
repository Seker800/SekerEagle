import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EagleImportItemAction,
  EagleImportItemStatus,
  EagleImportRunStatus,
  Prisma,
  UploadSessionStatus,
} from '@prisma/client';
import { UPLOAD_PART_SIZE_BYTES } from '../../upload-limits';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  SEKER_EAGLE_INGESTION_PORT,
  type SekerEagleIngestionPort,
} from '../../../seker-eagle-ingestion.port';
import {
  buildEagleImportCandidateTags,
  EagleImportManifestChunkInput,
  EAGLE_IMPORT_MANIFEST_VERSIONS,
  isSupportedEagleImportMedia,
  mapEagleImportItemMetadata,
  validateEagleImportManifestChunk,
} from '../../eagle-app-import-manifest';
import type {
  CreateEagleImportRunInput,
  EagleImportsRepository,
} from '../../eagle-app-import.repository';
import {
  ACTIVE_EAGLE_IMPORT_ITEM_STATUSES,
  canFinalizeEagleImportUpload,
  canPreflightEagleImport,
  canRunAcceptEagleImportUpload,
  canStageEagleImportManifest,
  canStartEagleImportUpload,
  isTerminalEagleImportItem,
  resolveEagleImportRunCompletion,
  resolveEagleImportAction,
} from '../../eagle-app-import-policy';
import { eagleImportProgressMode } from '../../eagle-app-import-progress-mode';

const RUN_SELECT = {
  id: true,
  externalLibraryId: true,
  idempotencyKey: true,
  declarationHash: true,
  manifestVersion: true,
  status: true,
  declaredItemCount: true,
  declaredByteSize: true,
  stagedItemCount: true,
  importedItemCount: true,
  skippedItemCount: true,
  failedItemCount: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  lastErrorCode: true,
  createdAt: true,
  updatedAt: true,
  externalLibrary: { select: { externalLibraryId: true } },
} satisfies Prisma.EagleImportRunSelect;

type ImportRunProjection = Prisma.EagleImportRunGetPayload<{ select: typeof RUN_SELECT }>;

const IMPORT_ITEM_SELECT = {
  id: true,
  sourceItemId: true,
  displayName: true,
  originalFileName: true,
  mimeType: true,
  byteSize: true,
  status: true,
  action: true,
  attemptCount: true,
  warningCodes: true,
  errorCode: true,
  errorMessage: true,
  assetId: true,
  completedAt: true,
  updatedAt: true,
  activeUploadSessionId: true,
} satisfies Prisma.EagleImportRunItemSelect;

type ImportItemProjection = Prisma.EagleImportRunItemGetPayload<{
  select: typeof IMPORT_ITEM_SELECT;
}>;

interface ImportPreflightSummary {
  itemCount: bigint;
  byteSize: bigint;
  readyItemCount: bigint;
  alreadyImportedItemCount: bigint;
  skippedDeletedItemCount: bigint;
  skippedUnsupportedItemCount: bigint;
  warningCount: bigint;
  newItemCount: bigint;
  unchangedItemCount: bigint;
  metadataUpdateItemCount: bigint;
  contentReplaceItemCount: bigint;
  uploadItemCount: bigint;
  uploadByteSize: bigint;
  missingFolderIds: string[];
}

interface ImportMetadataSource {
  id: string;
  runId: string;
  externalAssetId: string;
  displayName: string;
  sourceImportedAt: Date | null;
  sourceModifiedAt: Date | null;
  metadataHash: string;
  contentSha256: string | null;
  sourceFileModifiedAt: Date | null;
  byteSize: bigint;
  rating: number | null;
  description: string | null;
  sourceUrl: string | null;
  tagNames: string[];
}

@Injectable()
export class PrismaEagleImportsRepository implements EagleImportsRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEKER_EAGLE_INGESTION_PORT)
    private readonly ingestion: SekerEagleIngestionPort<Prisma.TransactionClient>,
  ) {}

  async createRun(ownerId: string, input: CreateEagleImportRunInput) {
    if (!EAGLE_IMPORT_MANIFEST_VERSIONS.includes(input.manifestVersion as 1 | 2)) {
      throw new BadRequestException('不支持的 Eagle 导入清单版本。');
    }
    const declarationHash = hashRunDeclaration(input);
    const existingBeforeLibraryMutation = await this.prisma.eagleImportRun.findUnique({
      where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: input.idempotencyKey } },
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
            ownerId_provider_externalLibraryId: {
              ownerId,
              provider: 'EAGLE_APP',
              externalLibraryId: input.externalLibraryId,
            },
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
          },
          select: { id: true },
        });
        resolvedLibraryId = library.id;
        const existing = await transaction.eagleImportRun.findUnique({
          where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: input.idempotencyKey } },
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
          },
          select: RUN_SELECT,
        });
        return this.serializeRun(created);
      });
    } catch (error) {
      if (!resolvedLibraryId || !isPrismaUniqueConstraintError(error)) throw error;
      const replay = await this.prisma.eagleImportRun.findUnique({
        where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: input.idempotencyKey } },
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
        where: { id: runId, ownerId },
        select: { id: true, externalLibraryId: true, status: true, createdAt: true },
      });
      if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
      if (!canStageEagleImportManifest(run.status)) {
        throw new ConflictException('Eagle 导入任务已经完成清单阶段。');
      }

      const existingChunk = await transaction.eagleImportManifestChunk.findUnique({
        where: { runId_chunkKey: { runId, chunkKey: input.chunkKey } },
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
        where: { ownerId, runId },
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
            where: { runId, sourceItemId: { in: sourceItemIds } },
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
        await transaction.eagleExternalAsset.createMany({ data: newExternalAssets });
      }
      const externalAssets = sourceItemIds.length
        ? await transaction.eagleExternalAsset.findMany({
            where: {
              ownerId,
              externalLibraryId: run.externalLibraryId,
              externalItemId: { in: sourceItemIds },
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
        await transaction.eagleImportRunItem.createMany({ data: runItems });
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
        where: { id: runId },
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
    return this.prisma.$transaction(
      async (transaction) => {
        await lockImportRun(transaction, ownerId, runId);
        const run = await transaction.eagleImportRun.findFirst({
          where: { id: runId, ownerId },
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

        await this.synchronizeMappedItems(transaction, ownerId, runId);
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
                WHERE referenced_item."ownerId" = ${ownerId}
                  AND referenced_item."runId" = ${runId}
                  AND folder."id" IS NULL
              ), ARRAY[]::text[]) AS "missingFolderIds"
            FROM "EagleImportRunItem" item
            WHERE item."ownerId" = ${ownerId} AND item."runId" = ${runId}
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
            expected: { itemCount: run.declaredItemCount, byteSize: Number(run.declaredByteSize) },
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
          readyItemCount === 0 ? EagleImportRunStatus.COMPLETED : EagleImportRunStatus.PREFLIGHTED;
        await transaction.eagleImportRun.update({
          where: { id: runId },
          data: {
            stagedItemCount: readyItemCount,
            importedItemCount: Number(summary.alreadyImportedItemCount),
            skippedItemCount:
              Number(summary.skippedDeletedItemCount) + Number(summary.skippedUnsupportedItemCount),
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
  }

  async getRun(ownerId: string, runId: string) {
    const run = await this.prisma.eagleImportRun.findFirst({
      where: { id: runId, ownerId },
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
      WHERE library."ownerId" = ${ownerId}
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

  async listItems(
    ownerId: string,
    runId: string,
    input: { limit?: number; cursor?: string; status?: EagleImportItemStatus },
  ) {
    await this.assertRun(ownerId, runId);
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const cursorId = input.cursor ? decodeItemCursor(input.cursor) : null;
    const rows = await this.prisma.eagleImportRunItem.findMany({
      where: {
        ownerId,
        runId,
        ...(input.status ? { status: input.status } : {}),
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: IMPORT_ITEM_SELECT,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const activeSessionIds = page
      .map((item) => item.activeUploadSessionId)
      .filter((id): id is string => Boolean(id));
    const sessions = activeSessionIds.length
      ? await this.prisma.uploadSession.findMany({
          where: { uploaderId: ownerId, id: { in: activeSessionIds } },
          select: { id: true, status: true, createdAt: true, updatedAt: true },
        })
      : [];
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    return {
      items: page.map((item) =>
        this.serializeItem(item, sessionsById.get(item.activeUploadSessionId ?? '')),
      ),
      nextCursor: hasMore && page.length ? encodeItemCursor(page.at(-1)!.id) : null,
    };
  }

  async retryItem(ownerId: string, runId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await lockImportRun(transaction, ownerId, runId);
      await lockImportItem(transaction, ownerId, runId, itemId);
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { id: itemId, runId, ownerId },
        select: {
          id: true,
          runId: true,
          status: true,
          activeUploadSessionId: true,
          terminalProgressAppliedAt: true,
          run: { select: { status: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (item.run.status === EagleImportRunStatus.CANCELLED) {
        throw new ConflictException('已取消的 Eagle 导入任务不能重试。');
      }
      if (item.status !== EagleImportItemStatus.FAILED) {
        throw new ConflictException('只有失败的 Eagle 导入项可以重试。');
      }
      if (item.activeUploadSessionId) {
        await transaction.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: item.activeUploadSessionId, ownerId },
          data: { supersededAt: new Date() },
        });
      }
      const updated = await transaction.eagleImportRunItem.update({
        where: { id: itemId },
        data: {
          status: EagleImportItemStatus.STAGED,
          activeUploadSessionId: null,
          errorCode: null,
          errorMessage: null,
          terminalProgressAppliedAt: null,
          completedAt: null,
        },
        select: IMPORT_ITEM_SELECT,
      });
      await transaction.eagleImportRun.update({
        where: { id: runId },
        data: {
          stagedItemCount: { increment: 1 },
          ...(item.terminalProgressAppliedAt ? { failedItemCount: { decrement: 1 } } : {}),
          status: EagleImportRunStatus.RUNNING,
          completedAt: null,
        },
      });
      return this.serializeItem(updated);
    });
  }

  async resetUpload(ownerId: string, runId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await lockImportRun(transaction, ownerId, runId);
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { id: itemId, runId, ownerId },
        select: {
          id: true,
          status: true,
          activeUploadSessionId: true,
          terminalProgressAppliedAt: true,
          run: { select: { status: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (item.run.status === EagleImportRunStatus.CANCELLED) {
        throw new ConflictException('已取消的 Eagle 导入任务不能重置上传。');
      }
      const session = item.activeUploadSessionId
        ? await transaction.uploadSession.findFirst({
            where: { id: item.activeUploadSessionId, uploaderId: ownerId },
            select: { status: true, createdAt: true },
          })
        : null;
      const expired = Boolean(
        session &&
        session.status === UploadSessionStatus.INITIATED &&
        session.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1_000,
      );
      const resettableSession =
        !session ||
        expired ||
        session.status === UploadSessionStatus.ABORTED ||
        session.status === UploadSessionStatus.FAILED;
      if (
        item.status !== EagleImportItemStatus.FAILED &&
        !(item.status === EagleImportItemStatus.UPLOADING && resettableSession)
      ) {
        throw new ConflictException('正常上传或正在完成的 Eagle 导入项不能重置。');
      }
      if (item.activeUploadSessionId) {
        await transaction.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: item.activeUploadSessionId, ownerId },
          data: { supersededAt: new Date() },
        });
      }
      const updated = await transaction.eagleImportRunItem.update({
        where: { id: item.id },
        data: {
          status: EagleImportItemStatus.STAGED,
          activeUploadSessionId: null,
          errorCode: null,
          errorMessage: null,
          terminalProgressAppliedAt: null,
          completedAt: null,
        },
        select: IMPORT_ITEM_SELECT,
      });
      await transaction.eagleImportRun.update({
        where: { id: runId },
        data: {
          stagedItemCount: { increment: 1 },
          ...(item.status === EagleImportItemStatus.FAILED && item.terminalProgressAppliedAt
            ? { failedItemCount: { decrement: 1 } }
            : {}),
          status: EagleImportRunStatus.RUNNING,
          completedAt: null,
        },
      });
      return this.serializeItem(updated);
    });
  }

  async cancel(ownerId: string, runId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const run = await transaction.eagleImportRun.findFirst({
        where: { id: runId, ownerId },
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
          },
          data: { status: EagleImportItemStatus.CANCELLED, completedAt: cancelledAt },
        });
        await transaction.eagleImportRun.update({
          where: { id: runId },
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

  async reconcile(ownerId: string, runId: string) {
    const [run, groups, [diagnostics]] = await Promise.all([
      this.assertRun(ownerId, runId),
      this.prisma.eagleImportRunItem.groupBy({
        by: ['status'],
        where: { ownerId, runId },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        Array<{
          staleMappings: bigint;
          orphanedActiveSessions: bigint;
          expiredActiveSessions: bigint;
          completedSessionsPendingConvergence: bigint;
          contentHashMismatches: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COUNT(*) FILTER (
              WHERE item."status" = 'IMPORTED'
                AND (item."assetId" IS NULL OR external."assetId" IS DISTINCT FROM item."assetId")
            )::bigint AS "staleMappings",
            COUNT(*) FILTER (
              WHERE item."activeUploadSessionId" IS NOT NULL AND session."id" IS NULL
            )::bigint AS "orphanedActiveSessions",
            COUNT(*) FILTER (
              WHERE item."activeUploadSessionId" IS NOT NULL
                AND session."status" = 'INITIATED'
                AND session."createdAt" < NOW() - INTERVAL '24 hours'
            )::bigint AS "expiredActiveSessions",
            COUNT(*) FILTER (
              WHERE item."status" <> 'IMPORTED' AND session."status" = 'COMPLETED'
            )::bigint AS "completedSessionsPendingConvergence",
            COUNT(*) FILTER (
              WHERE item."status" = 'IMPORTED'
                AND item."contentSha256" IS NOT NULL
                AND external."sourceContentSha256" IS DISTINCT FROM item."contentSha256"
            )::bigint AS "contentHashMismatches"
          FROM "EagleImportRunItem" item
          JOIN "EagleExternalAsset" external ON external."id" = item."externalAssetId"
          LEFT JOIN "UploadSession" session ON session."id" = item."activeUploadSessionId"
          WHERE item."ownerId" = ${ownerId} AND item."runId" = ${runId}
        `,
      ),
    ]);
    if (!diagnostics) throw new Error('Eagle 导入对账聚合未返回结果。');
    const staleMappings = Number(diagnostics.staleMappings);
    const orphanedActiveSessions = Number(diagnostics.orphanedActiveSessions);
    const expiredActiveSessions = Number(diagnostics.expiredActiveSessions);
    const completedSessionsPendingConvergence = Number(
      diagnostics.completedSessionsPendingConvergence,
    );
    const contentHashMismatches = Number(diagnostics.contentHashMismatches);
    const actual = countGroupedItemStatuses(groups);
    return {
      runId,
      consistent:
        staleMappings === 0 &&
        orphanedActiveSessions === 0 &&
        expiredActiveSessions === 0 &&
        completedSessionsPendingConvergence === 0 &&
        contentHashMismatches === 0 &&
        run.stagedItemCount === actual.stagedItemCount &&
        run.importedItemCount === actual.importedItemCount &&
        run.skippedItemCount === actual.skippedItemCount &&
        run.failedItemCount === actual.failedItemCount,
      staleMappings,
      orphanedActiveSessions,
      expiredActiveSessions,
      completedSessionsPendingConvergence,
      contentHashMismatches,
      recorded: {
        stagedItemCount: run.stagedItemCount,
        importedItemCount: run.importedItemCount,
        skippedItemCount: run.skippedItemCount,
        failedItemCount: run.failedItemCount,
      },
      actual,
    };
  }

  async prepareUploadStart(ownerId: string, runId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await lockImportItem(transaction, ownerId, runId, itemId);
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { id: itemId, ownerId, runId },
        select: {
          status: true,
          action: true,
          contentSha256: true,
          assetId: true,
          activeUploadSessionId: true,
          run: { select: { status: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (!canRunAcceptEagleImportUpload(item.run.status)) {
        throw new ConflictException('Eagle 导入任务必须先通过预检。');
      }
      if (item.status === EagleImportItemStatus.IMPORTED) {
        return { kind: 'IMPORTED' as const, assetId: item.assetId };
      }
      if (item.status === EagleImportItemStatus.FINALIZING) {
        return {
          kind: 'FINALIZING' as const,
          sessionId: item.activeUploadSessionId,
        };
      }
      if (item.status === EagleImportItemStatus.UPLOADING && item.activeUploadSessionId) {
        const session = await transaction.uploadSession.findFirst({
          where: { id: item.activeUploadSessionId, uploaderId: ownerId },
          select: { status: true, createdAt: true, finalizationAttempts: true },
        });
        const expired = Boolean(
          session &&
          session.status === UploadSessionStatus.INITIATED &&
          session.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1_000,
        );
        const replaceable =
          !session ||
          expired ||
          session.status === UploadSessionStatus.ABORTED ||
          (session.status === UploadSessionStatus.FAILED && session.finalizationAttempts >= 10);
        if (!replaceable) {
          return { kind: 'RESUME' as const, sessionId: item.activeUploadSessionId };
        }
        const replacedSessionId = item.activeUploadSessionId;
        await transaction.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: replacedSessionId, ownerId },
          data: { supersededAt: new Date() },
        });
        await transaction.eagleImportRunItem.update({
          where: { id: itemId },
          data: { status: EagleImportItemStatus.STAGED, activeUploadSessionId: null },
        });
        await transaction.eagleImportRun.update({
          where: { id: runId },
          data: { stagedItemCount: { increment: 1 } },
        });
        return {
          kind: 'CREATE' as const,
          replacedSessionId,
          action: item.action,
          assetId: item.assetId,
          contentSha256: item.contentSha256,
        };
      }
      if (item.status !== EagleImportItemStatus.STAGED) {
        throw new ConflictException('当前 Eagle 导入项不能开始上传。');
      }
      return {
        kind: 'CREATE' as const,
        replacedSessionId: null,
        action: item.action,
        assetId: item.assetId,
        contentSha256: item.contentSha256,
      };
    });
  }

  async bindUploadSession(input: {
    ownerId: string;
    runId: string;
    runItemId: string;
    uploadSessionId: string;
    fileName: string;
    mimeType: string;
    size: bigint;
  }): Promise<{ accepted: boolean; activeUploadSessionId: string }> {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { id: input.runItemId, ownerId: input.ownerId, runId: input.runId },
        select: {
          id: true,
          runId: true,
          originalFileName: true,
          mimeType: true,
          byteSize: true,
          status: true,
          activeUploadSessionId: true,
          run: { select: { status: true, startedAt: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (!canRunAcceptEagleImportUpload(item.run.status)) {
        throw new ConflictException('Eagle 导入任务必须先通过预检。');
      }
      if (
        item.originalFileName !== input.fileName ||
        item.mimeType !== input.mimeType ||
        item.byteSize !== input.size
      ) {
        throw new BadRequestException('上传文件与 Eagle 清单声明不一致。');
      }
      if (item.status === EagleImportItemStatus.UPLOADING && item.activeUploadSessionId) {
        return { accepted: false, activeUploadSessionId: item.activeUploadSessionId };
      }
      if (!canStartEagleImportUpload(item.run.status, item.status)) {
        throw new ConflictException('当前 Eagle 导入项不能开始上传。');
      }
      const claimed = await transaction.eagleImportRunItem.updateMany({
        where: { id: item.id, ownerId: input.ownerId, status: EagleImportItemStatus.STAGED },
        data: {
          status: EagleImportItemStatus.UPLOADING,
          activeUploadSessionId: input.uploadSessionId,
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        const winner = await transaction.eagleImportRunItem.findFirst({
          where: { id: item.id, ownerId: input.ownerId },
          select: { activeUploadSessionId: true },
        });
        if (winner?.activeUploadSessionId) {
          return { accepted: false, activeUploadSessionId: winner.activeUploadSessionId };
        }
        throw new ConflictException('Eagle 导入项已被其他上传占用。');
      }
      await transaction.eagleImportRun.update({
        where: { id: item.runId },
        data: {
          stagedItemCount: { decrement: 1 },
          status: EagleImportRunStatus.RUNNING,
          startedAt: item.run.startedAt ?? new Date(),
        },
      });
      return { accepted: true, activeUploadSessionId: input.uploadSessionId };
    });
  }

  async finalizeUpload(ownerId: string, uploadSessionId: string, assetId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { ownerId, activeUploadSessionId: uploadSessionId },
        select: {
          id: true,
          runId: true,
          externalAssetId: true,
          displayName: true,
          sourceImportedAt: true,
          sourceModifiedAt: true,
          metadataHash: true,
          contentSha256: true,
          sourceFileModifiedAt: true,
          byteSize: true,
          rating: true,
          description: true,
          sourceUrl: true,
          tagNames: true,
          assetId: true,
          status: true,
          action: true,
          attemptCount: true,
          activeUploadSessionId: true,
          run: { select: { status: true } },
        },
      });
      if (!item) return null;
      if (item.status === EagleImportItemStatus.IMPORTED && item.assetId === assetId) {
        return {
          runId: item.runId,
          runItemId: item.id,
          action: item.action,
          attemptCount: item.attemptCount,
          byteSize: Number(item.byteSize),
        };
      }
      if (!canFinalizeEagleImportUpload(item.status)) {
        throw new ConflictException('当前 Eagle 导入项不能完成导入。');
      }
      if (item.status === EagleImportItemStatus.UPLOADING) {
        const claimed = await transaction.eagleImportRunItem.updateMany({
          where: {
            id: item.id,
            ownerId,
            status: EagleImportItemStatus.UPLOADING,
            activeUploadSessionId: uploadSessionId,
          },
          data: { status: EagleImportItemStatus.FINALIZING },
        });
        if (claimed.count !== 1) throw new ConflictException('Eagle 导入项正在由其他请求完成。');
      }

      await this.applyImportMetadata(transaction, ownerId, item, assetId);
      const completedAt = new Date();
      await transaction.eagleExternalAsset.update({
        where: { id: item.externalAssetId },
        data: {
          assetId,
          sourceImportedAt: item.sourceImportedAt,
          sourceModifiedAt: item.sourceModifiedAt,
          metadataHash: item.metadataHash,
          sourceContentSha256: item.contentSha256 ?? undefined,
          sourceFileModifiedAt: item.sourceFileModifiedAt ?? undefined,
          sourceByteSize: item.byteSize,
          lastSeenAt: completedAt,
          lastImportedAt: completedAt,
        },
      });
      await transaction.eagleImportRunItem.update({
        where: { id: item.id },
        data: {
          assetId,
          status: EagleImportItemStatus.IMPORTED,
          errorCode: null,
          errorMessage: null,
          completedAt,
        },
      });
      await this.applyTerminalItemDelta(
        transaction,
        ownerId,
        item.runId,
        [item.id],
        { importedItemCount: 1 },
        completedAt,
      );
      return {
        runId: item.runId,
        runItemId: item.id,
        action: item.action,
        attemptCount: item.attemptCount,
        byteSize: Number(item.byteSize),
      };
    });
  }

  async markUploadFailed(
    ownerId: string,
    uploadSessionId: string,
    error: unknown,
    context: { terminal: boolean; permanent: boolean },
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { ownerId, activeUploadSessionId: uploadSessionId },
        select: {
          id: true,
          runId: true,
          status: true,
          activeUploadSessionId: true,
          run: { select: { status: true } },
        },
      });
      if (
        !item ||
        item.activeUploadSessionId !== uploadSessionId ||
        isTerminalEagleImportItem(item.status)
      )
        return;
      const updated = await transaction.eagleImportRunItem.updateMany({
        where: {
          id: item.id,
          ownerId,
          activeUploadSessionId: uploadSessionId,
          status: { in: [EagleImportItemStatus.UPLOADING, EagleImportItemStatus.FINALIZING] },
        },
        data: {
          ...(context.terminal
            ? {
                status: EagleImportItemStatus.FAILED,
                completedAt: new Date(),
              }
            : {}),
          errorCode: isContentHashMismatch(error)
            ? 'CONTENT_HASH_MISMATCH'
            : context.permanent || error instanceof BadRequestException
              ? 'INVALID_MEDIA'
              : 'UPLOAD_FINALIZATION_FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown',
        },
      });
      if (updated.count !== 1) return;
      const completedAt = new Date();
      if (!context.terminal) {
        await transaction.eagleImportRun.update({
          where: { id: item.runId },
          data: { lastErrorCode: 'ITEM_FAILED' },
        });
      } else {
        await this.applyTerminalItemDelta(
          transaction,
          ownerId,
          item.runId,
          [item.id],
          { failedItemCount: 1 },
          completedAt,
          'ITEM_FAILED',
        );
      }
    });
  }

  async expireUploadSession(
    ownerId: string,
    uploadSessionId: string,
    expiredAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const expired = await transaction.uploadSession.updateMany({
        where: {
          id: uploadSessionId,
          uploaderId: ownerId,
          status: UploadSessionStatus.INITIATED,
        },
        data: {
          status: UploadSessionStatus.ABORTED,
          abortedAt: expiredAt,
        },
      });
      if (expired.count !== 1) return false;

      const item = await transaction.eagleImportRunItem.findFirst({
        where: {
          ownerId,
          activeUploadSessionId: uploadSessionId,
          status: EagleImportItemStatus.UPLOADING,
        },
        select: {
          id: true,
          runId: true,
          run: { select: { status: true } },
        },
      });
      if (!item) return true;

      const converged = await transaction.eagleImportRunItem.updateMany({
        where: {
          id: item.id,
          ownerId,
          activeUploadSessionId: uploadSessionId,
          status: EagleImportItemStatus.UPLOADING,
        },
        data: {
          status: EagleImportItemStatus.FAILED,
          activeUploadSessionId: null,
          errorCode: 'UPLOAD_SESSION_EXPIRED',
          errorMessage: '上传会话已过期或不可恢复。',
          completedAt: expiredAt,
        },
      });
      if (converged.count !== 1) return true;

      await transaction.eagleUploadSessionState.updateMany({
        where: { ownerId, uploadSessionId },
        data: { supersededAt: expiredAt },
      });
      await this.applyTerminalItemDelta(
        transaction,
        ownerId,
        item.runId,
        [item.id],
        { failedItemCount: 1 },
        expiredAt,
        'UPLOAD_SESSION_EXPIRED',
      );
      return true;
    });
  }

  async reconcileStaleUploadSessions(): Promise<number> {
    const completedSessions = await this.prisma.$queryRaw<
      Array<{ ownerId: string; uploadSessionId: string; assetId: string }>
    >(Prisma.sql`
      SELECT
        item."ownerId",
        item."activeUploadSessionId" AS "uploadSessionId",
        state."assetId"
      FROM "EagleImportRunItem" item
      JOIN "UploadSession" session ON session."id" = item."activeUploadSessionId"
      JOIN "EagleUploadSessionState" state ON state."uploadSessionId" = session."id"
      WHERE item."status" IN ('UPLOADING', 'FINALIZING')
        AND session."status" = 'COMPLETED'
        AND state."assetId" IS NOT NULL
      ORDER BY item."updatedAt" ASC
      LIMIT 500
    `);
    let completedConverged = 0;
    for (const session of completedSessions) {
      try {
        await this.finalizeUpload(session.ownerId, session.uploadSessionId, session.assetId);
        completedConverged += 1;
      } catch {
        // A later reconciler pass retries; the completed upload and object remain durable.
      }
    }

    const staleConverged = await this.prisma.$transaction(async (transaction) => {
      const converged = await transaction.$queryRaw<
        Array<{ id: string; ownerId: string; runId: string; uploadSessionId: string }>
      >(Prisma.sql`
        WITH candidates AS (
          SELECT item."id", item."activeUploadSessionId"
          FROM "EagleImportRunItem" item
          LEFT JOIN "UploadSession" session ON session."id" = item."activeUploadSessionId"
          WHERE item."status" = 'UPLOADING'
            AND item."activeUploadSessionId" IS NOT NULL
            AND (
              session."id" IS NULL
              OR session."status" = 'ABORTED'
              OR (session."status" = 'FAILED' AND session."finalizationAttempts" >= 10)
              OR (
                session."status" = 'INITIATED'
                AND session."createdAt" < NOW() - INTERVAL '24 hours'
              )
            )
          ORDER BY item."updatedAt" ASC
          LIMIT 500
          FOR UPDATE OF item SKIP LOCKED
        )
        UPDATE "EagleImportRunItem" item
        SET
          "status" = 'FAILED',
          "activeUploadSessionId" = NULL,
          "errorCode" = 'UPLOAD_SESSION_EXPIRED',
          "errorMessage" = '上传会话已过期或不可恢复。',
          "completedAt" = NOW(),
          "updatedAt" = NOW()
        FROM candidates
        WHERE item."id" = candidates."id"
        RETURNING
          item."id",
          item."ownerId",
          item."runId",
          candidates."activeUploadSessionId" AS "uploadSessionId"
      `);
      if (converged.length) {
        await transaction.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: { in: converged.map((item) => item.uploadSessionId) } },
          data: { supersededAt: new Date() },
        });
      }
      const runDeltas = new Map<
        string,
        { ownerId: string; runId: string; count: number; itemIds: string[] }
      >();
      for (const item of converged) {
        const key = `${item.ownerId}:${item.runId}`;
        const current = runDeltas.get(key);
        if (current) {
          current.count += 1;
          current.itemIds.push(item.id);
        } else {
          runDeltas.set(key, {
            ownerId: item.ownerId,
            runId: item.runId,
            count: 1,
            itemIds: [item.id],
          });
        }
      }
      for (const { ownerId, runId, count, itemIds } of runDeltas.values()) {
        await this.applyTerminalItemDelta(
          transaction,
          ownerId,
          runId,
          itemIds,
          { failedItemCount: count },
          new Date(),
          'UPLOAD_SESSION_EXPIRED',
        );
      }
      return converged.length;
    });
    return completedConverged + staleConverged;
  }

  async backfillTerminalProgress(
    limit: number,
  ): Promise<{ runsReconciled: number; itemsMarked: number }> {
    const safeLimit = Math.min(1_000, Math.max(1, Math.trunc(limit)));
    return this.prisma.$transaction(async (transaction) => {
      const [run] = await transaction.$queryRaw<Array<{ id: string; ownerId: string }>>(
        Prisma.sql`
          SELECT run."id", run."ownerId"
          FROM "EagleImportRun" run
          WHERE EXISTS (
            SELECT 1
            FROM "EagleImportRunItem" item
            WHERE item."runId" = run."id"
              AND item."terminalProgressAppliedAt" IS NULL
              AND item."status" IN ('IMPORTED', 'SKIPPED', 'FAILED')
          )
          ORDER BY run."updatedAt" ASC, run."id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      if (!run) return { runsReconciled: 0, itemsMarked: 0 };

      const groups = await transaction.eagleImportRunItem.groupBy({
        by: ['status'],
        where: { ownerId: run.ownerId, runId: run.id },
        _count: { _all: true },
      });
      await transaction.eagleImportRun.update({
        where: { id: run.id },
        data: countGroupedItemStatuses(groups),
      });

      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT item."id"
        FROM "EagleImportRunItem" item
        WHERE item."ownerId" = ${run.ownerId}
          AND item."runId" = ${run.id}
          AND item."terminalProgressAppliedAt" IS NULL
          AND item."status" IN ('IMPORTED', 'SKIPPED', 'FAILED')
        ORDER BY item."updatedAt" ASC, item."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${safeLimit}
      `);
      if (!candidates.length) return { runsReconciled: 1, itemsMarked: 0 };

      const marked = await transaction.eagleImportRunItem.updateMany({
        where: {
          id: { in: candidates.map(({ id }) => id) },
          terminalProgressAppliedAt: null,
        },
        data: { terminalProgressAppliedAt: new Date() },
      });
      if (marked.count !== candidates.length) {
        throw new Error('Eagle 导入进度兼容回填标记不完整。');
      }
      return { runsReconciled: 1, itemsMarked: marked.count };
    });
  }

  async projectTerminalItemProgress(limit: number): Promise<number> {
    const safeLimit = Math.min(1_000, Math.max(1, Math.trunc(limit)));
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<
        Array<{
          id: string;
          ownerId: string;
          runId: string;
          status: EagleImportItemStatus;
        }>
      >(Prisma.sql`
        SELECT item."id", item."ownerId", item."runId", item."status"
        FROM "EagleImportRunItem" item
        WHERE item."terminalProgressAppliedAt" IS NULL
          AND item."status" IN ('IMPORTED', 'SKIPPED', 'FAILED')
        ORDER BY item."runId" ASC, item."updatedAt" ASC, item."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${safeLimit}
      `);
      if (!candidates.length) return 0;

      const byRun = new Map<
        string,
        {
          ownerId: string;
          runId: string;
          itemIds: string[];
          importedItemCount: number;
          skippedItemCount: number;
          failedItemCount: number;
        }
      >();
      for (const candidate of candidates) {
        const key = `${candidate.ownerId}:${candidate.runId}`;
        const group = byRun.get(key) ?? {
          ownerId: candidate.ownerId,
          runId: candidate.runId,
          itemIds: [],
          importedItemCount: 0,
          skippedItemCount: 0,
          failedItemCount: 0,
        };
        group.itemIds.push(candidate.id);
        if (candidate.status === EagleImportItemStatus.IMPORTED) group.importedItemCount += 1;
        if (candidate.status === EagleImportItemStatus.SKIPPED) group.skippedItemCount += 1;
        if (candidate.status === EagleImportItemStatus.FAILED) group.failedItemCount += 1;
        byRun.set(key, group);
      }

      const projectedAt = new Date();
      for (const group of byRun.values()) {
        await this.applyProjectedTerminalItems(transaction, group, projectedAt);
      }
      return candidates.length;
    });
  }

  async pruneTerminalRuns(input: {
    retentionDays: number;
    keepPerLibrary: number;
    limit: number;
  }): Promise<number> {
    const cutoff = new Date(Date.now() - input.retentionDays * 24 * 60 * 60 * 1_000);
    const deleted = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH ranked AS (
        SELECT
          run."id",
          run."completedAt",
          run."cancelledAt",
          run."updatedAt",
          ROW_NUMBER() OVER (
            PARTITION BY run."ownerId", run."externalLibraryId"
            ORDER BY run."createdAt" DESC, run."id" DESC
          ) AS position
        FROM "EagleImportRun" run
        WHERE run."status" IN ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')
      ), candidates AS (
        SELECT ranked."id"
        FROM ranked
        WHERE ranked.position > ${input.keepPerLibrary}
          AND COALESCE(ranked."completedAt", ranked."cancelledAt", ranked."updatedAt") < ${cutoff}
        ORDER BY COALESCE(ranked."completedAt", ranked."cancelledAt", ranked."updatedAt") ASC
        LIMIT ${input.limit}
      )
      DELETE FROM "EagleImportRun" run
      USING candidates
      WHERE run."id" = candidates."id"
      RETURNING run."id"
    `);
    return deleted.length;
  }

  private async assertRun(ownerId: string, runId: string) {
    const run = await this.prisma.eagleImportRun.findFirst({
      where: { id: runId, ownerId },
      select: RUN_SELECT,
    });
    if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
    return run;
  }

  private async applyImportMetadata(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    item: ImportMetadataSource,
    assetId: string,
  ) {
    const normalizedNames = [...new Set(item.tagNames.map(normalizeIdentity))];
    const tagDefinitions = normalizedNames.length
      ? await transaction.eagleImportTagDefinition.findMany({
          where: { ownerId, runId: item.runId, normalizedName: { in: normalizedNames } },
        })
      : [];
    const groupSourceIds = [
      ...new Set(tagDefinitions.flatMap((definition) => definition.groupSourceIds)),
    ];
    const groupDefinitions = groupSourceIds.length
      ? await transaction.eagleImportTagGroupDefinition.findMany({
          where: { ownerId, runId: item.runId, sourceGroupId: { in: groupSourceIds } },
        })
      : [];
    const definitionByName = new Map(
      tagDefinitions.map((definition) => [definition.normalizedName, definition]),
    );
    const groupBySourceId = new Map(groupDefinitions.map((group) => [group.sourceGroupId, group]));
    const tags = item.tagNames.map((name) => {
      const normalizedName = normalizeIdentity(name);
      const definition = definitionByName.get(normalizedName);
      return {
        name,
        normalizedName,
        color: definition?.color ?? null,
        isStarred: definition?.isStarred ?? false,
        groups: (definition?.groupSourceIds ?? [])
          .map((sourceGroupId) => groupBySourceId.get(sourceGroupId))
          .filter((group) => group !== undefined)
          .map((group) => ({
            name: group.name,
            normalizedName: group.normalizedName,
            color: group.color,
            description: group.description,
          })),
      };
    });

    await this.ingestion.applyMetadata(
      {
        sourceKey: `eagle-app:${item.externalAssetId}`,
        ownerId,
        assetId,
        displayName: item.displayName,
        rating: item.rating,
        libraryAddedAt: item.sourceImportedAt,
        description: item.description,
        sourceUrl: item.sourceUrl,
        tags,
      },
      transaction,
    );
  }

  private async applyTerminalItemDelta(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    runId: string,
    itemIds: string[],
    delta: Partial<Record<'importedItemCount' | 'skippedItemCount' | 'failedItemCount', number>>,
    completedAt: Date,
    lastErrorCode?: string,
  ) {
    if (eagleImportProgressMode() === 'PROJECTED') return;
    const run = await transaction.eagleImportRun.update({
      where: { id: runId },
      data: {
        ...counterDeltaIncrements(delta),
        ...(lastErrorCode ? { lastErrorCode } : {}),
      },
      select: {
        status: true,
        importedItemCount: true,
        skippedItemCount: true,
        failedItemCount: true,
      },
    });
    const marked = await transaction.eagleImportRunItem.updateMany({
      where: { id: { in: itemIds }, terminalProgressAppliedAt: null },
      data: { terminalProgressAppliedAt: completedAt },
    });
    if (marked.count !== itemIds.length) {
      throw new Error('Eagle 导入进度同步标记不完整。');
    }
    if (run.status === EagleImportRunStatus.CANCELLED) return;
    const activeItem = await transaction.eagleImportRunItem.findFirst({
      where: { ownerId, runId, status: { in: [...ACTIVE_EAGLE_IMPORT_ITEM_STATUSES] } },
      select: { id: true },
    });
    await transaction.eagleImportRun.update({
      where: { id: runId },
      data: {
        status: resolveEagleImportRunCompletion({
          activeItemCount: activeItem ? 1 : 0,
          importedItemCount: run.importedItemCount,
          skippedItemCount: run.skippedItemCount,
          failedItemCount: run.failedItemCount,
        }),
        completedAt: activeItem ? null : completedAt,
      },
    });
  }

  private async applyProjectedTerminalItems(
    transaction: Prisma.TransactionClient,
    group: {
      ownerId: string;
      runId: string;
      itemIds: string[];
      importedItemCount: number;
      skippedItemCount: number;
      failedItemCount: number;
    },
    projectedAt: Date,
  ): Promise<void> {
    const run = await transaction.eagleImportRun.update({
      where: { id: group.runId },
      data: {
        ...counterDeltaIncrements({
          importedItemCount: group.importedItemCount,
          skippedItemCount: group.skippedItemCount,
          failedItemCount: group.failedItemCount,
        }),
        ...(group.failedItemCount > 0 ? { lastErrorCode: 'ITEM_FAILED' } : {}),
      },
      select: {
        status: true,
        importedItemCount: true,
        skippedItemCount: true,
        failedItemCount: true,
      },
    });
    const marked = await transaction.eagleImportRunItem.updateMany({
      where: { id: { in: group.itemIds }, terminalProgressAppliedAt: null },
      data: { terminalProgressAppliedAt: projectedAt },
    });
    if (marked.count !== group.itemIds.length) {
      throw new Error('Eagle 导入进度投影标记不完整。');
    }
    if (run.status === EagleImportRunStatus.CANCELLED) return;
    const activeItem = await transaction.eagleImportRunItem.findFirst({
      where: {
        ownerId: group.ownerId,
        runId: group.runId,
        status: { in: [...ACTIVE_EAGLE_IMPORT_ITEM_STATUSES] },
      },
      select: { id: true },
    });
    await transaction.eagleImportRun.update({
      where: { id: group.runId },
      data: {
        status: resolveEagleImportRunCompletion({
          activeItemCount: activeItem ? 1 : 0,
          importedItemCount: run.importedItemCount,
          skippedItemCount: run.skippedItemCount,
          failedItemCount: run.failedItemCount,
        }),
        completedAt: activeItem ? null : projectedAt,
      },
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
            where: { runId, sourceFolderId: { in: folders.map((item) => item.sourceFolderId) } },
            select: { sourceFolderId: true, name: true, parentSourceFolderId: true },
          })
        : [],
      tagGroups.length
        ? transaction.eagleImportTagGroupDefinition.findMany({
            where: { runId, sourceGroupId: { in: tagGroups.map((item) => item.sourceGroupId) } },
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
            where: { runId, normalizedName: { in: tags.map((item) => item.normalizedName) } },
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
            data: folders,
            skipDuplicates: true,
          })
        : undefined,
      tagGroups.length
        ? transaction.eagleImportTagGroupDefinition.createMany({
            data: tagGroups,
            skipDuplicates: true,
          })
        : undefined,
      tags.length
        ? transaction.eagleImportTagDefinition.createMany({ data: tags, skipDuplicates: true })
        : undefined,
    ]);
  }

  private async synchronizeMappedItems(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    runId: string,
  ) {
    let cursorId: string | undefined;
    while (true) {
      const items = await transaction.eagleImportRunItem.findMany({
        where: {
          ownerId,
          runId,
          status: EagleImportItemStatus.STAGED,
          action: EagleImportItemAction.METADATA_UPDATE,
          assetId: { not: null },
        },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: {
          id: true,
          runId: true,
          externalAssetId: true,
          displayName: true,
          sourceImportedAt: true,
          sourceModifiedAt: true,
          metadataHash: true,
          contentSha256: true,
          sourceFileModifiedAt: true,
          byteSize: true,
          rating: true,
          description: true,
          sourceUrl: true,
          tagNames: true,
          assetId: true,
        },
      });
      if (!items.length) return;
      for (const item of items) {
        if (!item.assetId) continue;
        await this.applyImportMetadata(transaction, ownerId, item, item.assetId);
        const completedAt = new Date();
        await transaction.eagleExternalAsset.update({
          where: { id: item.externalAssetId },
          data: {
            sourceImportedAt: item.sourceImportedAt,
            sourceModifiedAt: item.sourceModifiedAt,
            metadataHash: item.metadataHash,
            sourceContentSha256: item.contentSha256 ?? undefined,
            sourceFileModifiedAt: item.sourceFileModifiedAt ?? undefined,
            sourceByteSize: item.byteSize,
            lastSeenAt: completedAt,
            lastImportedAt: completedAt,
          },
        });
        await transaction.eagleImportRunItem.update({
          where: { id: item.id },
          data: {
            status: EagleImportItemStatus.IMPORTED,
            errorCode: null,
            errorMessage: null,
            terminalProgressAppliedAt: completedAt,
            completedAt,
          },
        });
      }
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

  private serializeItem(
    item: ImportItemProjection,
    session?: { id: string; status: UploadSessionStatus; createdAt: Date; updatedAt: Date },
  ) {
    const { activeUploadSessionId: _activeUploadSessionId, ...view } = item;
    void _activeUploadSessionId;
    return {
      ...view,
      byteSize: Number(item.byteSize),
      activeUpload: session
        ? {
            sessionId: session.id,
            status: session.status,
            partSizeBytes: UPLOAD_PART_SIZE_BYTES,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            expiresAt: new Date(session.createdAt.getTime() + 24 * 60 * 60 * 1_000),
          }
        : null,
    };
  }
}

async function lockImportRun(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  runId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "EagleImportRun" WHERE "ownerId" = ${ownerId} AND "id" = ${runId} FOR UPDATE`,
  );
}

async function lockImportItem(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  runId: string,
  itemId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "EagleImportRunItem" WHERE "ownerId" = ${ownerId} AND "runId" = ${runId} AND "id" = ${itemId} FOR UPDATE`,
  );
}

async function recordSourceObservations(
  transaction: Prisma.TransactionClient,
  observations: Array<{
    externalAssetId: string;
    action: EagleImportItemAction;
    contentSha256: string | null;
    sourceFileModifiedAt: Date | null;
    sourceByteSize: bigint;
    metadataHash: string;
    observedAt: Date;
  }>,
) {
  if (!observations.length) return;
  const payload = observations.map((item) => ({
    ...item,
    sourceFileModifiedAt: item.sourceFileModifiedAt?.toISOString() ?? null,
    sourceByteSize: item.sourceByteSize.toString(),
    observedAt: item.observedAt.toISOString(),
  }));
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "EagleExternalAsset" external
    SET
      "lastSeenAt" = observation."observedAt"::timestamp,
      "sourceContentSha256" = CASE
        WHEN observation."action" = 'UNCHANGED' AND observation."contentSha256" IS NOT NULL
        THEN observation."contentSha256"
        ELSE external."sourceContentSha256"
      END,
      "sourceFileModifiedAt" = CASE
        WHEN observation."action" = 'UNCHANGED' AND observation."sourceFileModifiedAt" IS NOT NULL
        THEN observation."sourceFileModifiedAt"::timestamp
        ELSE external."sourceFileModifiedAt"
      END,
      "sourceByteSize" = CASE
        WHEN observation."action" = 'UNCHANGED'
        THEN observation."sourceByteSize"::bigint
        ELSE external."sourceByteSize"
      END,
      "metadataHash" = CASE
        WHEN observation."action" = 'UNCHANGED'
        THEN observation."metadataHash"
        ELSE external."metadataHash"
      END,
      "lastImportedAt" = CASE
        WHEN observation."action" = 'UNCHANGED'
        THEN observation."observedAt"::timestamp
        ELSE external."lastImportedAt"
      END,
      "updatedAt" = NOW()
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS observation(
      "externalAssetId" text,
      "action" text,
      "contentSha256" text,
      "sourceFileModifiedAt" text,
      "sourceByteSize" text,
      "metadataHash" text,
      "observedAt" text
    )
    WHERE external."id" = observation."externalAssetId"
  `);
}

function countGroupedItemStatuses(
  groups: Array<{ status: EagleImportItemStatus; _count: { _all: number } }>,
) {
  const counts = new Map(groups.map((group) => [group.status, group._count._all]));
  return {
    stagedItemCount: counts.get(EagleImportItemStatus.STAGED) ?? 0,
    importedItemCount: counts.get(EagleImportItemStatus.IMPORTED) ?? 0,
    skippedItemCount: counts.get(EagleImportItemStatus.SKIPPED) ?? 0,
    failedItemCount: counts.get(EagleImportItemStatus.FAILED) ?? 0,
  };
}

function countItemStatuses(items: ReadonlyArray<{ status: EagleImportItemStatus }>) {
  const groups = new Map<EagleImportItemStatus, number>();
  for (const item of items) groups.set(item.status, (groups.get(item.status) ?? 0) + 1);
  return {
    stagedItemCount: groups.get(EagleImportItemStatus.STAGED) ?? 0,
    importedItemCount: groups.get(EagleImportItemStatus.IMPORTED) ?? 0,
    skippedItemCount: groups.get(EagleImportItemStatus.SKIPPED) ?? 0,
    failedItemCount: groups.get(EagleImportItemStatus.FAILED) ?? 0,
  };
}

function counterIncrements(counts: ReturnType<typeof countItemStatuses>) {
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([field, count]) => [field, { increment: count }]),
  );
}

function counterDeltaIncrements(
  delta: Partial<Record<'importedItemCount' | 'skippedItemCount' | 'failedItemCount', number>>,
) {
  return Object.fromEntries(
    Object.entries(delta)
      .filter(([, count]) => count !== undefined && count !== 0)
      .map(([field, count]) => [field, { increment: count }]),
  );
}

function assertMatchingRunDeclaration(
  run: Pick<
    ImportRunProjection,
    | 'externalLibraryId'
    | 'manifestVersion'
    | 'declaredItemCount'
    | 'declaredByteSize'
    | 'declarationHash'
  >,
  externalLibraryId: string,
  input: CreateEagleImportRunInput,
  declarationHash: string,
) {
  if (
    run.externalLibraryId !== externalLibraryId ||
    (run.declarationHash !== null && run.declarationHash !== declarationHash) ||
    run.manifestVersion !== input.manifestVersion ||
    run.declaredItemCount !== input.declaredItemCount ||
    run.declaredByteSize !== BigInt(input.declaredByteSize)
  ) {
    throw new ConflictException('该幂等键已用于另一份 Eagle 导入声明。');
  }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function isContentHashMismatch(error: unknown): boolean {
  if (!(error instanceof BadRequestException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    response.code === 'CONTENT_HASH_MISMATCH'
  );
}

function requireStableDefinitions<T extends Record<string, unknown>>(
  definitions: T[],
  keyOf: (definition: T) => string,
  label: string,
): T[] {
  const unique = new Map<string, T>();
  for (const definition of definitions) {
    const key = keyOf(definition);
    const prior = unique.get(key);
    if (prior && stableJson(definitionValue(prior)) !== stableJson(definitionValue(definition))) {
      throw new ConflictException(`同一 Eagle ${label}标识不能声明不同内容：${key}`);
    }
    unique.set(key, prior ?? definition);
  }
  return [...unique.values()];
}

function assertDefinitionsUnchanged<TIncoming extends Record<string, unknown>, TExisting>(
  incoming: TIncoming[],
  existing: TExisting[],
  keyOf: (definition: TIncoming & TExisting) => string,
  label: string,
) {
  const incomingByKey = new Map(
    incoming.map((item) => [keyOf(item as TIncoming & TExisting), item]),
  );
  for (const definition of existing) {
    const key = keyOf(definition as TIncoming & TExisting);
    const candidate = incomingByKey.get(key);
    if (
      candidate &&
      stableJson(definitionValue(candidate)) !==
        stableJson(definitionValue(definition as Record<string, unknown>))
    ) {
      throw new ConflictException(`Eagle ${label}定义在不同分块中不一致：${key}`);
    }
  }
}

function definitionValue(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['id', 'ownerId', 'runId', 'createdAt', 'updatedAt'].includes(key))
      .map(([key, nested]) => [key, Array.isArray(nested) ? [...(nested as unknown[])].sort() : nested]),
  );
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function hashRunDeclaration(input: CreateEagleImportRunInput): string {
  return hashValue({
    manifestVersion: input.manifestVersion,
    externalLibraryId: input.externalLibraryId.normalize('NFKC').trim(),
    libraryName: input.libraryName.normalize('NFKC').trim(),
    sourceModifiedAt: input.sourceModifiedAt?.toISOString() ?? null,
    declaredItemCount: input.declaredItemCount,
    declaredByteSize: input.declaredByteSize,
  });
}

function buildMetadataHash(
  item: EagleImportManifestChunkInput['items'][number],
  metadata: ReturnType<typeof mapEagleImportItemMetadata>,
  tagNames: string[],
): string {
  return hashValue({
    displayName: metadata.displayName,
    rating: metadata.rating,
    description: metadata.description,
    sourceUrl: metadata.sourceUrl,
    libraryAddedAt: metadata.libraryAddedAt,
    sourceModifiedAt: metadata.sourceModifiedAt,
    tagNames,
    folderIds: [...new Set(item.folderIds)].sort(),
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (!nestedValue || typeof nestedValue !== 'object' || Array.isArray(nestedValue)) {
      return nestedValue;
    }
    return Object.fromEntries(
      Object.entries(nestedValue as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  });
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function cleanName(value: string): string {
  const name = value.normalize('NFKC').trim();
  if (!name) throw new BadRequestException('Eagle 清单名称不能为空。');
  return name;
}

function cleanOptional(value: string | null | undefined): string | null {
  const normalized = value?.normalize('NFKC').trim() ?? '';
  return normalized || null;
}

function encodeItemCursor(id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, id })).toString('base64url');
}

function encodeRunCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt: updatedAt.toISOString(), id })).toString(
    'base64url',
  );
}

function decodeRunCursor(value: string): { updatedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const updatedAt = new Date(String(parsed.updatedAt));
    if (
      parsed.v !== 1 ||
      typeof parsed.id !== 'string' ||
      !parsed.id.trim() ||
      Number.isNaN(updatedAt.getTime())
    ) {
      throw new Error();
    }
    return { updatedAt, id: parsed.id };
  } catch {
    throw new BadRequestException('Eagle 导入任务游标无效。');
  }
}

function decodeItemCursor(value: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (parsed.v !== 1 || typeof parsed.id !== 'string' || !parsed.id.trim()) throw new Error();
    return parsed.id;
  } catch {
    throw new BadRequestException('Eagle 导入项游标无效。');
  }
}
