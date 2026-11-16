import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import type {
  BatchChangeEagleManualTagsDto,
  CreateManualTagDto,
  CreateManualTagGroupDto,
  UpdateManualTagDto,
  UpdateManualTagGroupDto,
} from './eagle.dto';
import { findSearchAssets } from './eagle-asset-search';
import { LIBRARY_MODE, inLibrary } from './library-mode';
import { runLibraryTransaction } from './eagle-library-command';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from './eagle-privacy.service';
import {
  refreshUnclassifiedSuggestions,
  syncCurrentTagMemberDistances,
} from './eagle-vector.persistence';
import { createEagleTagPhonetics } from './eagle-tag-phonetics';
import { PrismaService } from '../prisma/prisma.service';
import {
  isForeignKeyError,
  isUniqueError,
  normalizeColor,
  normalizeKey,
  normalizeName,
  privateVisibilityWhere,
  visibleManualTagWhere,
} from './eagle-library-values';

const BATCH_TAG_WRITE_ASSET_CHUNK_SIZE = 100;

@Injectable()
export class LibraryManualTagService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
  ) {}

  async assertCommandTags(ownerId: string, tagIds: string[], groupId?: string | null) {
    const ids = [...new Set(tagIds)];
    const count = await this.prisma.eagleManualTag.count({
      where: { ownerId, libraryMode: this.libraryMode, id: { in: ids } },
    });
    if (count !== ids.length) throw new NotFoundException('一个或多个标签不存在。');
    if (
      groupId &&
      !(await this.prisma.eagleManualTagGroup.count({
        where: { ownerId, libraryMode: this.libraryMode, id: groupId },
      }))
    )
      throw new NotFoundException('标签组不存在。');
  }

  async batchChangeManualTags(
    ownerId: string,
    input: BatchChangeEagleManualTagsDto,
    includePrivate = false,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const tagIds = [...new Set([...input.addTagIds, ...input.removeTagIds])];
    const [assets, tags] = await Promise.all([
      findSearchAssets(db, {
        where: {
          ownerId,
          id: { in: input.assetIds },
          deletedAt: null,
          ...privateVisibilityWhere(includePrivate),
          libraryMode: this.libraryMode,
        },
        select: { id: true },
      }),
      db.eagleManualTag.findMany({
        where: { ownerId, id: { in: tagIds }, libraryMode: this.libraryMode },
        select: { id: true },
      }),
    ]);
    if (assets.length !== input.assetIds.length || tags.length !== tagIds.length) {
      throw new NotFoundException('一个或多个素材或标签不存在。');
    }
    const privacyChangedAssetCount = await runLibraryTransaction(db, async (transaction) => {
      await lockOwnerPrivacyProjection(transaction, ownerId, this.libraryMode);
      if (input.clearAll) {
        const where = { ownerId, assetId: { in: input.assetIds } };
        await transaction.eagleAssetManualTag.deleteMany({
          where: inLibrary(this.libraryMode, where),
        });
        await transaction.eagleTagMemberDistance.deleteMany({
          where: inLibrary(this.libraryMode, where),
        });
      } else if (input.removeTagIds.length) {
        await transaction.eagleAssetManualTag.deleteMany({
          where: {
            ownerId,
            assetId: { in: input.assetIds },
            tagId: { in: input.removeTagIds },
            libraryMode: this.libraryMode,
          },
        });
        await transaction.eagleTagMemberDistance.deleteMany({
          where: {
            ownerId,
            assetId: { in: input.assetIds },
            tagId: { in: input.removeTagIds },
            libraryMode: this.libraryMode,
          },
        });
      }
      if (input.addTagIds.length) {
        await transaction.eagleManualTag.updateMany({
          where: { ownerId, id: { in: input.addTagIds }, libraryMode: this.libraryMode },
          data: { lastUsedAt: new Date() },
        });
        for (
          let offset = 0;
          offset < input.assetIds.length;
          offset += BATCH_TAG_WRITE_ASSET_CHUNK_SIZE
        ) {
          const assetIds = input.assetIds.slice(offset, offset + BATCH_TAG_WRITE_ASSET_CHUNK_SIZE);
          await transaction.eagleAssetManualTag.updateMany({
            where: {
              ownerId,
              assetId: { in: assetIds },
              tagId: { in: input.addTagIds },
              libraryMode: this.libraryMode,
            },
            data: { assignedByUser: true },
          });
          await transaction.eagleAssetManualTag.createMany({
            data: assetIds
              .flatMap((assetId) => input.addTagIds.map((tagId) => ({ ownerId, assetId, tagId })))
              .map((row) => inLibrary(this.libraryMode, row)),
            skipDuplicates: true,
          });
          await syncCurrentTagMemberDistances(
            transaction,
            ownerId,
            assetIds,
            input.addTagIds,
            this.libraryMode,
          );
        }
      }
      if (input.clearAll || input.removeTagIds.length) {
        await refreshUnclassifiedSuggestions(transaction, {
          libraryMode: this.libraryMode,
          ownerId,
          assetIds: input.assetIds,
          includePrivate,
        });
      }
      return syncAssetPrivacy(transaction, ownerId, input.assetIds, this.libraryMode);
    });
    return { affectedAssetCount: input.assetIds.length, privacyChangedAssetCount };
  }

  async listManualTags(ownerId: string, includePrivate = false) {
    const tags = await this.prisma.eagleManualTag.findMany({
      where: { ownerId, libraryMode: this.libraryMode, ...visibleManualTagWhere(includePrivate) },
      orderBy: [{ isStarred: 'desc' }, { normalizedName: 'asc' }],
      select: {
        id: true,
        name: true,
        color: true,
        groupId: true,
        groupMemberships: { orderBy: { groupId: 'asc' }, select: { groupId: true } },
        isStarred: true,
        lastUsedAt: true,
        rowVersion: true,
        _count: {
          select: {
            assetLinks: {
              where: { asset: { deletedAt: null, ...privateVisibilityWhere(includePrivate) } },
            },
          },
        },
      },
    });
    return tags.map(({ groupMemberships, _count, ...tag }) => ({
      ...tag,
      groupIds: groupMemberships.map(({ groupId }) => groupId),
      assetCount: _count.assetLinks,
      ...createEagleTagPhonetics(tag.name),
    }));
  }

  async createManualTag(ownerId: string, input: CreateManualTagDto) {
    const name = normalizeName(input.name, 64, '标签名称');
    try {
      const tag = await this.prisma.eagleManualTag.create({
        data: {
          ownerId,
          name,
          normalizedName: normalizeKey(name),
          color: normalizeColor(input.color),
          libraryMode: this.libraryMode,
        },
        select: {
          id: true,
          name: true,
          color: true,
          isStarred: true,
          lastUsedAt: true,
          rowVersion: true,
        },
      });
      return {
        ...tag,
        groupId: null,
        groupIds: [],
        assetCount: 0,
        ...createEagleTagPhonetics(tag.name),
      };
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('标签名称已存在。');
      throw error;
    }
  }

  async updateManualTag(
    ownerId: string,
    tagId: string,
    input: UpdateManualTagDto,
    includePrivate = false,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const current = await db.eagleManualTag.findFirst({
      where: { ownerId, id: tagId, libraryMode: this.libraryMode },
    });
    if (!current) throw new NotFoundException('标签不存在。');
    const name =
      input.name === undefined ? current.name : normalizeName(input.name, 64, '标签名称');
    if (
      input.groupId &&
      !(await db.eagleManualTagGroup.count({
        where: { ownerId, id: input.groupId, libraryMode: this.libraryMode },
      }))
    )
      throw new NotFoundException('标签组不存在。');
    try {
      await runLibraryTransaction(db, async (transaction) => {
        const updated = await transaction.eagleManualTag.updateMany({
          where: {
            ownerId,
            id: tagId,
            rowVersion: input.rowVersion,
            libraryMode: this.libraryMode,
          },
          data: {
            name,
            normalizedName: normalizeKey(name),
            color: input.color === undefined ? current.color : normalizeColor(input.color),
            groupId: input.groupId === undefined ? current.groupId : input.groupId,
            isStarred: input.isStarred === undefined ? current.isStarred : input.isStarred,
            rowVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) await this.throwTagWriteError(transaction, ownerId, tagId);
        if (input.groupId !== undefined) {
          if (current.groupId && current.groupId !== input.groupId) {
            await transaction.eagleManualTagGroupMembership.deleteMany({
              where: { ownerId, tagId, groupId: current.groupId, libraryMode: this.libraryMode },
            });
          }
          if (input.groupId) {
            await transaction.eagleManualTagGroupMembership.createMany({
              data: [{ ownerId, tagId, groupId: input.groupId, libraryMode: this.libraryMode }],
              skipDuplicates: true,
            });
          }
        }
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('标签名称已存在。');
      throw error;
    }
    const tag = await db.eagleManualTag.findFirstOrThrow({
      where: { ownerId, id: tagId, libraryMode: this.libraryMode },
      select: {
        id: true,
        name: true,
        color: true,
        groupId: true,
        groupMemberships: { orderBy: { groupId: 'asc' }, select: { groupId: true } },
        isStarred: true,
        lastUsedAt: true,
        rowVersion: true,
        _count: {
          select: {
            assetLinks: {
              where: { asset: { deletedAt: null, ...privateVisibilityWhere(includePrivate) } },
            },
          },
        },
      },
    });
    const { groupMemberships, _count, ...fields } = tag;
    return {
      ...fields,
      groupIds: groupMemberships.map(({ groupId }) => groupId),
      assetCount: _count.assetLinks,
      ...createEagleTagPhonetics(tag.name),
    };
  }

  async deleteManualTag(
    ownerId: string,
    tagId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    try {
      await runLibraryTransaction(db, async (transaction) => {
        await lockOwnerPrivacyProjection(transaction, ownerId, this.libraryMode);
        const tag = await transaction.eagleManualTag.findFirst({
          where: { ownerId, id: tagId, libraryMode: this.libraryMode },
          select: { id: true, marksAssetsPrivate: true },
        });
        if (!tag) throw new NotFoundException('标签不存在。');
        if (tag.marksAssetsPrivate) {
          throw new ConflictException('请先在私密设置中移除该标签，再删除标签。');
        }
        await transaction.eagleAssetManualTag.deleteMany({
          where: { ownerId, tagId, libraryMode: this.libraryMode },
        });
        await transaction.eagleManualTag.delete({
          where: { id: tagId, libraryMode: this.libraryMode },
        });
        // A privacy-rule tag is rejected above while holding the projection lock.
        // Removing an ordinary tag cannot change any asset's privacy reasons.
      });
      return { deletedId: tagId };
    } catch (error) {
      if (isForeignKeyError(error))
        throw new ConflictException('标签正在被智能文件夹使用，无法删除。');
      throw error;
    }
  }

  async listManualTagGroups(ownerId: string, includePrivate = false) {
    const groups = await this.prisma.eagleManualTagGroup.findMany({
      where: {
        ownerId,
        libraryMode: this.libraryMode,
        ...(includePrivate
          ? {}
          : {
              OR: [
                { tagMemberships: { none: {} } },
                { tagMemberships: { some: { tag: visibleManualTagWhere(false) } } },
              ],
            }),
      },
      orderBy: { normalizedName: 'asc' },
      include: {
        _count: {
          select: { tagMemberships: { where: { tag: visibleManualTagWhere(includePrivate) } } },
        },
      },
    });
    return groups.map(({ _count, ...group }) => ({ ...group, tagCount: _count.tagMemberships }));
  }

  async createManualTagGroup(ownerId: string, input: CreateManualTagGroupDto) {
    const name = normalizeName(input.name, 64, '标签组名称');
    try {
      const group = await this.prisma.eagleManualTagGroup.create({
        data: {
          ownerId,
          name,
          normalizedName: normalizeKey(name),
          color: normalizeColor(input.color),
          description: input.description?.trim() || null,
          libraryMode: this.libraryMode,
        },
      });
      return { ...group, tagCount: 0 };
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('标签组名称已存在。');
      throw error;
    }
  }

  async updateManualTagGroup(ownerId: string, groupId: string, input: UpdateManualTagGroupDto) {
    const current = await this.prisma.eagleManualTagGroup.findFirst({
      where: { ownerId, id: groupId, libraryMode: this.libraryMode },
    });
    if (!current) throw new NotFoundException('标签组不存在。');
    const name =
      input.name === undefined ? current.name : normalizeName(input.name, 64, '标签组名称');
    try {
      const result = await this.prisma.eagleManualTagGroup.updateMany({
        where: {
          ownerId,
          id: groupId,
          rowVersion: input.rowVersion,
          libraryMode: this.libraryMode,
        },
        data: {
          name,
          normalizedName: normalizeKey(name),
          color: input.color === undefined ? current.color : normalizeColor(input.color),
          description:
            input.description === undefined
              ? current.description
              : input.description?.trim() || null,
          rowVersion: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new ConflictException('标签组已被更新，请刷新后重试。');
      const group = await this.prisma.eagleManualTagGroup.findFirstOrThrow({
        where: { ownerId, id: groupId, libraryMode: this.libraryMode },
        include: { _count: { select: { tagMemberships: true } } },
      });
      const { _count, ...fields } = group;
      return { ...fields, tagCount: _count.tagMemberships };
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('标签组名称已存在。');
      throw error;
    }
  }

  async deleteManualTagGroup(
    ownerId: string,
    groupId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const group = await db.eagleManualTagGroup.findFirst({
      where: { ownerId, id: groupId, libraryMode: this.libraryMode },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('标签组不存在。');
    await runLibraryTransaction(db, async (transaction) => {
      await transaction.eagleManualTag.updateMany({
        where: { ownerId, groupId, libraryMode: this.libraryMode },
        data: { groupId: null, rowVersion: { increment: 1 } },
      });
      await transaction.eagleManualTagGroup.delete({
        where: { id: groupId, libraryMode: this.libraryMode },
      });
    });
    return { deletedId: groupId };
  }

  private async throwTagWriteError(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    tagId: string,
  ): Promise<never> {
    if (
      !(await transaction.eagleManualTag.count({
        where: { ownerId, id: tagId, libraryMode: this.libraryMode },
      }))
    )
      throw new NotFoundException('标签不存在。');
    throw new ConflictException('标签已被其他操作更新，请刷新后重试。');
  }
}
