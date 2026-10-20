import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateEagleImportRunDto,
  EagleImportItemDto,
  EagleImportManifestChunkDto,
  ListEagleImportItemsDto,
} from './eagle-import.dto';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from './eagle-privacy.service';

@Injectable()
export class EagleImportService {
  constructor(private readonly prisma: PrismaService) {}

  async listLibraries(ownerId: string) {
    const libraries = await this.prisma.eagleExternalLibrary.findMany({
      where: { ownerId, libraryMode: 'MATERIAL' },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { assets: true } },
        assets: { orderBy: { lastImportedAt: 'desc' }, take: 1, select: { lastImportedAt: true } },
      },
    });
    return {
      libraries: libraries.map((library) => ({
        externalLibraryId: library.externalLibraryId,
        displayName: library.displayName,
        sourceModifiedAt: library.sourceModifiedAt,
        assetCount: library._count.assets,
        lastImportedAt: library.assets[0]?.lastImportedAt ?? null,
      })),
    };
  }

  async createRun(ownerId: string, input: CreateEagleImportRunDto) {
    const existing = await this.prisma.eagleImportRun.findUnique({
      where: {
        ownerId_libraryMode_idempotencyKey: {
          libraryMode: 'MATERIAL',
          ownerId,
          idempotencyKey: input.idempotencyKey,
        },
        libraryMode: 'MATERIAL',
      },
    });
    if (existing) return serializeRun(existing);
    const library = await this.prisma.eagleExternalLibrary.upsert({
      where: {
        ownerId_libraryMode_provider_externalLibraryId: {
          libraryMode: 'MATERIAL',
          ownerId,
          provider: 'EAGLE_APP',
          externalLibraryId: input.externalLibraryId,
        },
        libraryMode: 'MATERIAL',
      },
      create: {
        ownerId,
        externalLibraryId: input.externalLibraryId,
        displayName: normalized(input.libraryName, 255),
        sourceModifiedAt: input.sourceModifiedAt,
        libraryMode: 'MATERIAL',
      },
      update: {
        displayName: normalized(input.libraryName, 255),
        sourceModifiedAt: input.sourceModifiedAt,
      },
    });
    const run = await this.prisma.eagleImportRun.create({
      data: {
        ownerId,
        externalLibraryId: library.id,
        idempotencyKey: input.idempotencyKey,
        manifestVersion: input.manifestVersion,
        declaredItemCount: input.declaredItemCount,
        declaredByteSize: BigInt(input.declaredByteSize),
        libraryMode: 'MATERIAL',
      },
    });
    return serializeRun(run);
  }

  async getRun(ownerId: string, runId: string) {
    const run = await this.prisma.eagleImportRun.findFirst({
      where: { ownerId, id: runId, libraryMode: 'MATERIAL' },
    });
    if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
    return serializeRun(run);
  }

  async stageChunk(ownerId: string, runId: string, chunk: EagleImportManifestChunkDto) {
    const run = await this.requireDraftRun(ownerId, runId);
    if (chunk.manifestVersion !== run.manifestVersion)
      throw new BadRequestException('清单版本与任务不一致。');
    const contentHash = sha256Json(chunk);
    const replay = await this.prisma.eagleImportManifestChunk.findUnique({
      where: { runId_chunkKey: { runId, chunkKey: chunk.chunkKey }, libraryMode: 'MATERIAL' },
    });
    if (replay) {
      if (replay.contentHash !== contentHash)
        throw new ConflictException('相同清单分片键的内容不一致。');
      return {
        chunkKey: chunk.chunkKey,
        acceptedItemCount: replay.acceptedItemCount,
        skippedItemCount: replay.skippedItemCount,
        replayed: true,
      };
    }
    let acceptedItemCount = 0;
    let skippedItemCount = 0;
    await this.prisma.$transaction(async (transaction) => {
      for (const group of chunk.tagGroups) {
        await transaction.eagleImportTagGroupDefinition.create({
          data: {
            ownerId,
            runId,
            sourceGroupId: group.sourceId,
            name: normalized(group.name, 64),
            normalizedName: normalizeKey(group.name),
            color: group.color,
            description: group.description,
            libraryMode: 'MATERIAL',
          },
        });
      }
      for (const tag of chunk.tags) {
        await transaction.eagleImportTagDefinition.create({
          data: {
            ownerId,
            runId,
            name: normalized(tag.name, 64),
            normalizedName: normalizeKey(tag.name),
            color: tag.color,
            isStarred: tag.isStarred ?? false,
            groupSourceIds: tag.groupSourceIds ?? [],
            libraryMode: 'MATERIAL',
          },
        });
      }
      for (const folder of chunk.folders) {
        await transaction.eagleImportFolderDefinition.create({
          data: {
            ownerId,
            runId,
            sourceFolderId: folder.sourceId,
            name: normalized(folder.name, 255),
            parentSourceFolderId: folder.parentSourceId,
            libraryMode: 'MATERIAL',
          },
        });
      }
      for (const item of chunk.items) {
        const external = await transaction.eagleExternalAsset.upsert({
          where: {
            ownerId_externalLibraryId_externalItemId: {
              ownerId,
              externalLibraryId: run.externalLibraryId,
              externalItemId: item.sourceItemId,
            },
            libraryMode: 'MATERIAL',
          },
          create: {
            ownerId,
            externalLibraryId: run.externalLibraryId,
            externalItemId: item.sourceItemId,
            lastSeenAt: new Date(),
            libraryMode: 'MATERIAL',
          },
          update: { lastSeenAt: new Date() },
        });
        try {
          await transaction.eagleImportRunItem.create({
            data: { ...importItemData(ownerId, runId, external.id, item), libraryMode: 'MATERIAL' },
          });
          acceptedItemCount += 1;
        } catch (error) {
          if (isUnique(error)) skippedItemCount += 1;
          else throw error;
        }
      }
      await transaction.eagleImportManifestChunk.create({
        data: {
          ownerId,
          runId,
          chunkKey: chunk.chunkKey,
          contentHash,
          acceptedItemCount,
          skippedItemCount,
          libraryMode: 'MATERIAL',
        },
      });
      await transaction.eagleImportRun.update({
        where: { id: runId, libraryMode: 'MATERIAL' },
        data: { stagedItemCount: { increment: acceptedItemCount } },
      });
    });
    return { chunkKey: chunk.chunkKey, acceptedItemCount, skippedItemCount, replayed: false };
  }

  async preflight(ownerId: string, runId: string) {
    const run = await this.requireDraftRun(ownerId, runId);
    const items = await this.prisma.eagleImportRunItem.findMany({
      where: { ownerId, runId, libraryMode: 'MATERIAL' },
      include: { externalAsset: { include: { asset: true } } },
    });
    const counts = {
      newItemCount: 0,
      unchangedItemCount: 0,
      metadataUpdateItemCount: 0,
      contentReplaceItemCount: 0,
      skippedDeletedItemCount: 0,
      skippedUnsupportedItemCount: 0,
      uploadItemCount: 0,
      uploadByteSize: 0,
    };
    await this.prisma.$transaction(async (transaction) => {
      for (const item of items) {
        let action:
          | 'NEW'
          | 'UNCHANGED'
          | 'METADATA_UPDATE'
          | 'CONTENT_REPLACE'
          | 'SKIP_DELETED'
          | 'SKIP_UNSUPPORTED';
        if (item.warningCodes.includes('SOURCE_DELETED')) action = 'SKIP_DELETED';
        else if (!supportedMime(item.mimeType)) action = 'SKIP_UNSUPPORTED';
        else if (!item.externalAsset.asset) action = 'NEW';
        else if (
          item.contentSha256 &&
          item.externalAsset.sourceContentSha256 !== item.contentSha256
        )
          action = 'CONTENT_REPLACE';
        else if (item.externalAsset.metadataHash !== item.metadataHash) action = 'METADATA_UPDATE';
        else action = 'UNCHANGED';
        if (action === 'NEW') counts.newItemCount += 1;
        if (action === 'UNCHANGED') counts.unchangedItemCount += 1;
        if (action === 'METADATA_UPDATE') counts.metadataUpdateItemCount += 1;
        if (action === 'CONTENT_REPLACE') counts.contentReplaceItemCount += 1;
        if (action === 'SKIP_DELETED') counts.skippedDeletedItemCount += 1;
        if (action === 'SKIP_UNSUPPORTED') counts.skippedUnsupportedItemCount += 1;
        const needsUpload = action === 'NEW' || action === 'CONTENT_REPLACE';
        if (needsUpload) {
          counts.uploadItemCount += 1;
          counts.uploadByteSize += Number(item.byteSize);
        }
        if (action === 'METADATA_UPDATE' && item.externalAsset.assetId) {
          await applyImportedMetadata(
            transaction,
            ownerId,
            item.externalAsset.assetId,
            item,
            `eagle-library:${run.externalLibraryId}`,
          );
          await transaction.eagleExternalAsset.update({
            where: { id: item.externalAssetId, libraryMode: 'MATERIAL' },
            data: {
              metadataHash: item.metadataHash,
              sourceImportedAt: item.sourceImportedAt,
              sourceModifiedAt: item.sourceModifiedAt,
              lastImportedAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        }
        const terminal = !needsUpload;
        await transaction.eagleImportRunItem.update({
          where: { id: item.id, libraryMode: 'MATERIAL' },
          data: {
            action,
            status: action === 'METADATA_UPDATE' ? 'IMPORTED' : terminal ? 'SKIPPED' : 'STAGED',
            assetId: action === 'METADATA_UPDATE' ? item.externalAsset.assetId : undefined,
            completedAt: terminal ? new Date() : null,
            terminalProgressAppliedAt: terminal ? new Date() : null,
          },
        });
      }
      await transaction.eagleImportRun.update({
        where: { id: runId, libraryMode: 'MATERIAL' },
        data: {
          status: counts.uploadItemCount ? 'PREFLIGHTED' : 'COMPLETED',
          importedItemCount: counts.metadataUpdateItemCount,
          skippedItemCount:
            counts.unchangedItemCount +
            counts.skippedDeletedItemCount +
            counts.skippedUnsupportedItemCount,
          completedAt: counts.uploadItemCount ? null : new Date(),
        },
      });
    });
    return {
      runId,
      status: 'PREFLIGHTED',
      itemCount: items.length,
      byteSize: items.reduce((sum, item) => sum + Number(item.byteSize), 0),
      readyItemCount: counts.uploadItemCount + counts.metadataUpdateItemCount,
      alreadyImportedItemCount: counts.unchangedItemCount,
      warningCount: counts.skippedDeletedItemCount + counts.skippedUnsupportedItemCount,
      ...counts,
    };
  }

  async listItems(ownerId: string, runId: string, query: ListEagleImportItemsDto) {
    await this.getRun(ownerId, runId);
    const rows = await this.prisma.eagleImportRunItem.findMany({
      where: {
        ownerId,
        runId,
        status: query.status as never,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        libraryMode: 'MATERIAL',
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map(serializeItem),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async markUploading(ownerId: string, runId: string, itemId: string, uploadSessionId: string) {
    const result = await this.prisma.eagleImportRunItem.updateMany({
      where: {
        ownerId,
        runId,
        id: itemId,
        status: 'STAGED',
        action: { in: ['NEW', 'CONTENT_REPLACE'] },
        libraryMode: 'MATERIAL',
      },
      data: {
        status: 'UPLOADING',
        activeUploadSessionId: uploadSessionId,
        attemptCount: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException('导入项当前不可上传。');
  }

  async getUploadItem(ownerId: string, runId: string, itemId: string) {
    const item = await this.prisma.eagleImportRunItem.findFirst({
      where: {
        ownerId,
        runId,
        id: itemId,
        status: 'STAGED',
        action: { in: ['NEW', 'CONTENT_REPLACE'] },
        libraryMode: 'MATERIAL',
      },
      select: {
        originalFileName: true,
        mimeType: true,
        byteSize: true,
        contentSha256: true,
      },
    });
    if (!item) throw new ConflictException('导入项当前不可上传。');
    return item;
  }

  finishItem(
    ..._input: [ownerId: string, runId: string, itemId: string, assetId: string]
  ): Promise<never> {
    return Promise.reject(
      new GoneException(
        'Legacy import finish is retired; complete the server-bound upload session instead.',
      ),
    );
  }

  async cancel(ownerId: string, runId: string) {
    const result = await this.prisma.eagleImportRun.updateMany({
      where: {
        ownerId,
        id: runId,
        status: { in: ['DRAFT', 'PREFLIGHTED', 'RUNNING'] },
        libraryMode: 'MATERIAL',
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (result.count !== 1) throw new ConflictException('导入任务不能取消。');
    return { runId, status: 'CANCELLED' };
  }

  private async requireDraftRun(ownerId: string, runId: string) {
    const run = await this.prisma.eagleImportRun.findFirst({
      where: { ownerId, id: runId, status: 'DRAFT', libraryMode: 'MATERIAL' },
    });
    if (!run) throw new ConflictException('Eagle 导入任务不在清单阶段。');
    return run;
  }

  private async convergeRun(ownerId: string, runId: string) {
    const [pending, failed] = await Promise.all([
      this.prisma.eagleImportRunItem.count({
        where: {
          ownerId,
          runId,
          status: { in: ['STAGED', 'UPLOADING', 'FINALIZING'] },
          libraryMode: 'MATERIAL',
        },
      }),
      this.prisma.eagleImportRunItem.count({
        where: { ownerId, runId, status: 'FAILED', libraryMode: 'MATERIAL' },
      }),
    ]);
    if (!pending)
      await this.prisma.eagleImportRun.update({
        where: { id: runId, libraryMode: 'MATERIAL' },
        data: {
          status: failed ? 'PARTIAL' : 'COMPLETED',
          failedItemCount: failed,
          completedAt: new Date(),
        },
      });
  }
}

function importItemData(
  ownerId: string,
  runId: string,
  externalAssetId: string,
  item: EagleImportItemDto,
): Prisma.EagleImportRunItemUncheckedCreateInput {
  const metadata = {
    name: item.name,
    rating: item.star || null,
    description: item.annotation || null,
    sourceUrl: item.sourceUrl || null,
    tags: [...new Set(item.tagNames)].sort(),
    folders: [...new Set(item.folderIds)].sort(),
  };
  return {
    ownerId,
    runId,
    externalAssetId,
    sourceItemId: item.sourceItemId,
    displayName: normalized(item.name || item.originalFileName, 255),
    originalFileName: item.originalFileName,
    extension: item.extension.toLowerCase(),
    mimeType: item.mimeType.toLowerCase(),
    byteSize: BigInt(item.size),
    sourceImportedAt: item.importedAt ? new Date(item.importedAt) : null,
    sourceModifiedAt: item.modifiedAt ? new Date(item.modifiedAt) : null,
    rating: item.star || null,
    description: item.annotation || null,
    sourceUrl: validSourceUrl(item.sourceUrl),
    tagNames: metadata.tags,
    folderSourceIds: metadata.folders,
    metadataHash: sha256Json(metadata),
    contentSha256: item.contentSha256,
    sourceFileModifiedAt: item.sourceFileModifiedAt ? new Date(item.sourceFileModifiedAt) : null,
    warningCodes: item.isDeleted ? ['SOURCE_DELETED'] : [],
  };
}

function serializeRun(run: { declaredByteSize: bigint; [key: string]: unknown }) {
  return { ...run, declaredByteSize: Number(run.declaredByteSize) };
}
function serializeItem(item: {
  byteSize: bigint;
  externalAsset?: unknown;
  [key: string]: unknown;
}) {
  const publicItem = { ...item };
  delete publicItem.externalAsset;
  return { ...publicItem, byteSize: Number(item.byteSize) };
}
function normalized(value: string, max: number) {
  const result = value.normalize('NFKC').trim();
  if (!result || result.length > max) throw new BadRequestException('导入清单文本无效。');
  return result;
}
function normalizeKey(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}
function sha256Json(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function supportedMime(value: string) {
  return /^(image\/[a-z0-9.+-]+|video\/(mp4|quicktime|webm)|application\/pdf)$/i.test(value);
}
function validSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
function isUnique(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function applyImportedMetadata(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  assetId: string,
  item: {
    rating: number | null;
    description: string | null;
    sourceUrl: string | null;
    tagNames: string[];
  },
  sourceKey: string,
): Promise<void> {
  await lockOwnerPrivacyProjection(transaction, ownerId);
  const previous = await transaction.eagleAssetManualTagIngestion.findMany({
    where: { ownerId, assetId, sourceKey, libraryMode: 'MATERIAL' },
    select: { tagId: true },
  });
  await transaction.eagleAssetManualTagIngestion.deleteMany({
    where: { ownerId, assetId, sourceKey, libraryMode: 'MATERIAL' },
  });
  for (const tagName of item.tagNames) {
    const name = normalized(tagName, 100);
    const tag = await transaction.eagleManualTag.upsert({
      where: {
        ownerId_libraryMode_normalizedName: {
          libraryMode: 'MATERIAL',
          ownerId,
          normalizedName: normalizeKey(name),
        },
        libraryMode: 'MATERIAL',
      },
      create: { ownerId, name, normalizedName: normalizeKey(name), libraryMode: 'MATERIAL' },
      update: {},
      select: { id: true },
    });
    await transaction.eagleAssetManualTag.upsert({
      where: {
        ownerId_assetId_tagId: { ownerId, assetId, tagId: tag.id },
        libraryMode: 'MATERIAL',
      },
      create: { ownerId, assetId, tagId: tag.id, assignedByUser: false, libraryMode: 'MATERIAL' },
      update: {},
    });
    await transaction.eagleAssetManualTagIngestion.create({
      data: { ownerId, assetId, tagId: tag.id, sourceKey, libraryMode: 'MATERIAL' },
    });
  }
  for (const { tagId } of previous) {
    const link = await transaction.eagleAssetManualTag.findUnique({
      where: { ownerId_assetId_tagId: { ownerId, assetId, tagId }, libraryMode: 'MATERIAL' },
      select: { assignedByUser: true, _count: { select: { ingestionOrigins: true } } },
    });
    if (link && !link.assignedByUser && link._count.ingestionOrigins === 0) {
      await transaction.eagleAssetManualTag.delete({
        where: { ownerId_assetId_tagId: { ownerId, assetId, tagId }, libraryMode: 'MATERIAL' },
      });
    }
  }
  await transaction.eagleAsset.update({
    where: { id: assetId, libraryMode: 'MATERIAL' },
    data: { rating: item.rating },
  });
  await transaction.eagleAssetAnnotation.upsert({
    where: { ownerId_assetId: { ownerId, assetId }, libraryMode: 'MATERIAL' },
    create: {
      ownerId,
      assetId,
      description: item.description,
      sourceUrl: validSourceUrl(item.sourceUrl),
      libraryMode: 'MATERIAL',
    },
    update: { description: item.description, sourceUrl: validSourceUrl(item.sourceUrl) },
  });
  await syncAssetPrivacy(transaction, ownerId, [assetId]);
}
