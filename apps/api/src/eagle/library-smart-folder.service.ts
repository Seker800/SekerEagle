import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import { EAGLE_SEMANTIC_THRESHOLDS, readEagleSemanticIntent } from '@sekereagle/eagle-filter-core';
import { scheduleSmartFolderSnapshot } from '@sekereagle/library-persistence';
import type { CreateSmartFolderDto, MoveSmartFolderDto, UpdateSmartFolderDto } from './eagle.dto';
import { assertFilterMode, readEagleFilterQuery } from './eagle-filter-query';
import { LIBRARY_MODE, inLibrary } from './library-mode';
import { PrismaService } from '../prisma/prisma.service';
import {
  isEagleFilterQuery,
  isUniqueError,
  normalizeColor,
  normalizeKey,
  normalizeName,
  normalizeSmartFolderQuery,
  readSemanticIntent,
  readSmartFolderDependencies,
  readStoredQueryVersion,
  type SmartFolderDependencies,
} from './eagle-library-values';

@Injectable()
export class LibrarySmartFolderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
  ) {}

  async listSmartFolders(ownerId: string) {
    const rows = await this.prisma.eagleSmartFolder.findMany({
      where: { ownerId, libraryMode: this.libraryMode },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      include: {
        semanticSnapshots: {
          orderBy: [{ isActive: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            status: true,
            isActive: true,
            completedAt: true,
            updatedAt: true,
          },
        },
      },
    });
    return rows.map(({ semanticSnapshots, ...folder }) => ({
      ...folder,
      semanticState: semanticSnapshots.length
        ? {
            ...semanticSnapshots[0],
            hasResults: semanticSnapshots.some((snapshot) => snapshot.isActive),
          }
        : null,
    }));
  }

  async createSmartFolder(ownerId: string, input: CreateSmartFolderDto) {
    const parent = await this.resolveParent(ownerId, input.parentId);
    const name = normalizeName(input.name, 64, '智能文件夹名称');
    const position = await this.prisma.eagleSmartFolder.aggregate({
      where: { ownerId, parentId: parent?.id ?? null, libraryMode: this.libraryMode },
      _max: { position: true },
    });
    const queryJson = normalizeSmartFolderQuery(input.query, 'ANY');
    if (isEagleFilterQuery(queryJson))
      assertFilterMode(readEagleFilterQuery(queryJson), this.libraryMode);
    const dependencies = readSmartFolderDependencies(queryJson);
    await this.assertSmartFolderTagDependencies(ownerId, dependencies);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const folder = await transaction.eagleSmartFolder.create({
          data: {
            ownerId,
            parentId: parent?.id,
            name,
            normalizedName: normalizeKey(name),
            color: normalizeColor(input.color),
            queryVersion: readStoredQueryVersion(queryJson),
            queryJson,
            position: (position._max.position ?? -1) + 1,
            libraryMode: this.libraryMode,
          },
        });
        await this.replaceSmartFolderDependencies(transaction, ownerId, folder.id, dependencies);
        const semantic = isEagleFilterQuery(queryJson)
          ? readEagleSemanticIntent(readEagleFilterQuery(queryJson))
          : undefined;
        if (semantic)
          await scheduleSmartFolderSnapshot(
            transaction,
            { ownerId, libraryMode: this.libraryMode },
            folder.id,
            semantic,
            process.env.MLX_EMBEDDING_SPACE_ID ?? 'qwen3-vl-embedding-2b-1024-v1',
            EAGLE_SEMANTIC_THRESHOLDS[semantic.breadth],
          );
        return folder;
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('智能文件夹名称已存在。');
      throw error;
    }
  }

  async updateSmartFolder(ownerId: string, folderId: string, input: UpdateSmartFolderDto) {
    if (input.parentId === folderId)
      throw new BadRequestException('智能文件夹不能作为自己的父级。');
    const current = await this.prisma.eagleSmartFolder.findFirst({
      where: { ownerId, id: folderId, libraryMode: this.libraryMode },
    });
    if (!current) throw new NotFoundException('智能文件夹不存在。');
    if (
      input.name === undefined &&
      input.parentId === undefined &&
      input.color === undefined &&
      input.query === undefined
    )
      throw new BadRequestException('没有可更新的智能文件夹信息。');
    const parent =
      input.parentId === undefined
        ? await this.resolveParent(ownerId, current.parentId)
        : await this.resolveParent(ownerId, input.parentId);
    const childCount = await this.prisma.eagleSmartFolder.count({
      where: { ownerId, parentId: folderId, libraryMode: this.libraryMode },
    });
    if (input.parentId !== undefined && parent && childCount > 0)
      throw new BadRequestException('已有子级的文件夹不能继续嵌套。');
    const name =
      input.name === undefined ? current.name : normalizeName(input.name, 64, '智能文件夹名称');
    const queryJson =
      input.query === undefined ? undefined : normalizeSmartFolderQuery(input.query);
    if (queryJson && isEagleFilterQuery(queryJson))
      assertFilterMode(readEagleFilterQuery(queryJson), this.libraryMode);
    const dependencies = queryJson ? readSmartFolderDependencies(queryJson) : null;
    if (dependencies) await this.assertSmartFolderTagDependencies(ownerId, dependencies);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const result = await transaction.eagleSmartFolder.updateMany({
          where: {
            ownerId,
            id: folderId,
            rowVersion: input.rowVersion,
            libraryMode: this.libraryMode,
          },
          data: {
            parentId: input.parentId === undefined ? undefined : (parent?.id ?? null),
            name,
            normalizedName: normalizeKey(name),
            color: input.color === undefined ? undefined : normalizeColor(input.color),
            queryVersion: queryJson ? readStoredQueryVersion(queryJson) : undefined,
            queryJson,
            rowVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) await this.throwFolderWriteError(transaction, ownerId, folderId);
        if (dependencies) {
          await transaction.eagleSmartFolderManualTagDependency.deleteMany({
            where: { ownerId, smartFolderId: folderId, libraryMode: this.libraryMode },
          });
          await this.replaceSmartFolderDependencies(transaction, ownerId, folderId, dependencies);
        }
        if (queryJson && (readSemanticIntent(queryJson) || readSemanticIntent(current.queryJson))) {
          const semantic = readSemanticIntent(queryJson);
          await scheduleSmartFolderSnapshot(
            transaction,
            { ownerId, libraryMode: this.libraryMode },
            folderId,
            semantic,
            process.env.MLX_EMBEDDING_SPACE_ID ?? 'qwen3-vl-embedding-2b-1024-v1',
            semantic ? EAGLE_SEMANTIC_THRESHOLDS[semantic.breadth] : undefined,
          );
        }
        return transaction.eagleSmartFolder.findFirstOrThrow({
          where: { ownerId, id: folderId, libraryMode: this.libraryMode },
        });
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('智能文件夹名称已存在。');
      throw error;
    }
  }

  async moveSmartFolder(ownerId: string, folderId: string, input: MoveSmartFolderDto) {
    if (input.parentId === folderId)
      throw new BadRequestException('智能文件夹不能作为自己的父级。');
    return this.prisma.$transaction(
      async (transaction) => {
        const folder = await transaction.eagleSmartFolder.findFirst({
          where: { ownerId, id: folderId, libraryMode: this.libraryMode },
          select: { id: true, parentId: true, position: true },
        });
        if (!folder) throw new NotFoundException('智能文件夹不存在。');
        const parent = input.parentId
          ? await transaction.eagleSmartFolder.findFirst({
              where: { ownerId, id: input.parentId, libraryMode: this.libraryMode },
              select: { id: true, parentId: true },
            })
          : null;
        if (input.parentId && !parent) throw new NotFoundException('父级智能文件夹不存在。');
        if (parent?.parentId) throw new BadRequestException('智能文件夹最多两层。');
        if (
          parent &&
          (await transaction.eagleSmartFolder.count({
            where: { ownerId, parentId: folderId, libraryMode: this.libraryMode },
          }))
        )
          throw new BadRequestException('已有子级的文件夹不能继续嵌套。');

        const destinationSiblingCount = await transaction.eagleSmartFolder.count({
          where: {
            ownerId,
            parentId: input.parentId ?? null,
            id: { not: folderId },
            libraryMode: this.libraryMode,
          },
        });
        const destinationPosition = Math.min(input.position, destinationSiblingCount);
        if (folder.parentId === (input.parentId ?? null)) {
          if (destinationPosition < folder.position) {
            await transaction.eagleSmartFolder.updateMany({
              where: {
                ownerId,
                parentId: folder.parentId,
                id: { not: folderId },
                position: { gte: destinationPosition, lt: folder.position },
                libraryMode: this.libraryMode,
              },
              data: { position: { increment: 1 } },
            });
          } else if (destinationPosition > folder.position) {
            await transaction.eagleSmartFolder.updateMany({
              where: {
                ownerId,
                parentId: folder.parentId,
                id: { not: folderId },
                position: { gt: folder.position, lte: destinationPosition },
                libraryMode: this.libraryMode,
              },
              data: { position: { decrement: 1 } },
            });
          }
        } else {
          await transaction.eagleSmartFolder.updateMany({
            where: {
              ownerId,
              parentId: folder.parentId,
              id: { not: folderId },
              position: { gt: folder.position },
              libraryMode: this.libraryMode,
            },
            data: { position: { decrement: 1 } },
          });
          await transaction.eagleSmartFolder.updateMany({
            where: {
              ownerId,
              parentId: input.parentId ?? null,
              id: { not: folderId },
              position: { gte: destinationPosition },
              libraryMode: this.libraryMode,
            },
            data: { position: { increment: 1 } },
          });
        }
        const result = await transaction.eagleSmartFolder.updateMany({
          where: {
            ownerId,
            id: folderId,
            rowVersion: input.rowVersion,
            libraryMode: this.libraryMode,
          },
          data: {
            parentId: input.parentId ?? null,
            position: destinationPosition,
            rowVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new ConflictException('智能文件夹已被更新，请刷新后重试。');
        return transaction.eagleSmartFolder.findFirstOrThrow({
          where: { ownerId, id: folderId, libraryMode: this.libraryMode },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async deleteSmartFolder(ownerId: string, folderId: string) {
    if (
      await this.prisma.eagleSmartFolder.count({
        where: { ownerId, parentId: folderId, libraryMode: this.libraryMode },
      })
    ) {
      throw new ConflictException('请先删除或移出子级智能文件夹。');
    }
    const result = await this.prisma.eagleSmartFolder.deleteMany({
      where: { ownerId, id: folderId, libraryMode: this.libraryMode },
    });
    if (result.count !== 1) throw new NotFoundException('智能文件夹不存在。');
    return { id: folderId };
  }

  private async resolveParent(ownerId: string, parentId: string | null | undefined) {
    if (!parentId) return null;
    const parent = await this.prisma.eagleSmartFolder.findFirst({
      where: { ownerId, id: parentId, libraryMode: this.libraryMode },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new NotFoundException('父级智能文件夹不存在。');
    if (parent.parentId) throw new BadRequestException('智能文件夹最多两层。');
    return parent;
  }

  private async assertSmartFolderTagDependencies(
    ownerId: string,
    dependencies: SmartFolderDependencies,
  ) {
    const manualTagCount = await this.prisma.eagleManualTag.count({
      where: { ownerId, id: { in: dependencies.manualTagIds }, libraryMode: this.libraryMode },
    });
    if (manualTagCount !== dependencies.manualTagIds.length)
      throw new NotFoundException('一个或多个人工标签不存在。');
  }

  private async replaceSmartFolderDependencies(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    folderId: string,
    dependencies: SmartFolderDependencies,
  ) {
    if (dependencies.manualTagIds.length) {
      await transaction.eagleSmartFolderManualTagDependency.createMany({
        data: dependencies.manualTagIds
          .map((manualTagId) => ({
            ownerId,
            smartFolderId: folderId,
            manualTagId,
          }))
          .map((row) => inLibrary(this.libraryMode, row)),
      });
    }
  }

  private async throwFolderWriteError(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    folderId: string,
  ): Promise<never> {
    if (
      !(await transaction.eagleSmartFolder.count({
        where: { ownerId, id: folderId, libraryMode: this.libraryMode },
      }))
    )
      throw new NotFoundException('智能文件夹不存在。');
    throw new ConflictException('智能文件夹已被其他操作更新，请刷新后重试。');
  }
}
