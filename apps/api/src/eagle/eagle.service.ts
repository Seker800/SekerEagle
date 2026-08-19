import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EAGLE_FILTER_QUERY_VERSION, type EagleFilterQuery } from '@sekereagle/eagle-filter-core';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BatchChangeEagleManualTagsDto,
  BatchSetEagleAssetPrivacyDto,
  BatchUpdateEagleAssetsDto,
  CreateManualTagDto,
  CreateManualTagGroupDto,
  CreateSmartFolderDto,
  ListEagleAssetsDto,
  MoveSmartFolderDto,
  UpdateEagleAssetDto,
  UpdateManualTagDto,
  UpdateManualTagGroupDto,
  UpdateSmartFolderDto,
} from './eagle.dto';
import { buildColorAnalysisWhere, COLOR_PROCESSOR_VERSION } from './eagle-color-search';
import { createEagleTagPhonetics } from './eagle-tag-phonetics';
import { decodeEagleAssetCursor, encodeEagleAssetCursor } from './eagle-cursor';
import { syncCurrentTagMemberDistances } from './eagle-vector.persistence';
import {
  buildEagleFilterWhere,
  readEagleFilterQuery,
  readEagleFilterTagDependencies,
} from './eagle-filter-query';

const assetListInclude = Prisma.validator<Prisma.EagleAssetInclude>()({
  renditions: {
    where: { status: 'READY' },
    orderBy: [{ revision: 'desc' }, { kind: 'asc' }],
    select: {
      id: true,
      kind: true,
      revision: true,
      mimeType: true,
      byteSize: true,
      width: true,
      height: true,
    },
  },
  manualTagLinks: {
    orderBy: { tag: { normalizedName: 'asc' } },
    select: { tag: { select: { id: true, name: true, color: true } } },
  },
});

const assetInclude = Prisma.validator<Prisma.EagleAssetInclude>()({
  ...assetListInclude,
  annotation: { select: { color: true, description: true, sourceUrl: true } },
  aiTagLinks: {
    where: { status: 'ACTIVE' },
    orderBy: { confidence: 'desc' },
    select: { confidence: true, status: true, aiTag: { select: { id: true, name: true } } },
  },
  colorAnalyses: {
    where: { isCurrent: true, processorVersion: COLOR_PROCESSOR_VERSION },
    take: 1,
    include: { swatches: { orderBy: { rank: 'asc' } } },
  },
});

type AssetListRecord = Prisma.EagleAssetGetPayload<{ include: typeof assetListInclude }>;
type AssetRecord = Prisma.EagleAssetGetPayload<{ include: typeof assetInclude }>;
type AssetListOptions = { trash?: boolean; includePrivate?: boolean };

@Injectable()
export class EagleService {
  constructor(private readonly prisma: PrismaService) {}

  async listAssets(ownerId: string, query: ListEagleAssetsDto, options: AssetListOptions = {}) {
    const { trash = false, includePrivate = false } = options;
    const smartFolder = query.smartFolderId
      ? await this.prisma.eagleSmartFolder.findFirst({
          where: { ownerId, id: query.smartFolderId },
          select: {
            queryJson: true,
            children: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              select: { queryJson: true },
            },
          },
        })
      : null;
    if (query.smartFolderId && !smartFolder) throw new NotFoundException('智能文件夹不存在。');
    const folderQueries = smartFolder
      ? [smartFolder.queryJson, ...smartFolder.children.map(({ queryJson }) => queryJson)]
      : [];
    const legacyFolderFilters = folderQueries
      .filter((storedQuery) => !isEagleFilterQuery(storedQuery))
      .map(readSmartFolderFilters);
    const filters = omitRepeatedSmartFolderFilters(query, legacyFolderFilters);
    const cursor = query.cursor ? decodeEagleAssetCursor(query.cursor) : null;
    const baseConditions: Prisma.EagleAssetWhereInput[] = [
      buildAssetWhere(ownerId, filters, trash, includePrivate),
    ];
    const ruleQuery = query.rules ? parseEncodedFilterQuery(query.rules) : null;
    if (ruleQuery) baseConditions.push(buildEagleFilterWhere(ruleQuery));
    const filterColor =
      query.color ??
      readFilterColor(ruleQuery) ??
      folderQueries.map(readStoredFilterColor).find((value) => value !== undefined);
    const baseWhere: Prisma.EagleAssetWhereInput = { AND: baseConditions };
    const folderConditions = folderQueries.map((folder) =>
      buildStoredSmartFolderWhere(ownerId, folder, trash, includePrivate),
    );
    const folderWhere =
      folderConditions.length === 0
        ? null
        : folderConditions.length === 1
          ? folderConditions[0]
          : { OR: folderConditions };
    const queryWhere = folderWhere ? { AND: [baseWhere, folderWhere] } : baseWhere;
    const where: Prisma.EagleAssetWhereInput = cursor
      ? {
          AND: [
            queryWhere,
            {
              OR: [
                { libraryAddedAt: { lt: cursor.libraryAddedAt } },
                { libraryAddedAt: cursor.libraryAddedAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : queryWhere;
    const [rows, colorEligible, colorCompleted] = await Promise.all([
      this.prisma.eagleAsset.findMany({
        where,
        include: assetListInclude,
        orderBy: [{ libraryAddedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      filterColor
        ? this.prisma.eagleAsset.count({
            where: {
              ownerId,
              deletedAt: null,
              mimeType: { not: 'video/mp4' },
              ...privateVisibilityWhere(includePrivate),
            },
          })
        : Promise.resolve(0),
      filterColor
        ? this.prisma.eagleAssetColorAnalysis.count({
            where: {
              ownerId,
              processorVersion: COLOR_PROCESSOR_VERSION,
              isCurrent: true,
              status: 'COMPLETED',
              asset: {
                deletedAt: null,
                mimeType: { not: 'video/mp4' },
                ...privateVisibilityWhere(includePrivate),
              },
            },
          })
        : Promise.resolve(0),
    ]);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(serializeAssetList),
      nextCursor: hasMore && page.length ? encodeEagleAssetCursor(page.at(-1)!) : null,
      colorCoverage: filterColor
        ? {
            eligible: colorEligible,
            completed: colorCompleted,
            percentage: colorEligible ? Math.round((colorCompleted / colorEligible) * 100) : 100,
            processorVersion: COLOR_PROCESSOR_VERSION,
          }
        : null,
    };
  }

  async countAssets(ownerId: string, input: Record<string, unknown>, includePrivate = false) {
    const query = readEagleFilterQuery(input);
    return {
      count: await this.prisma.eagleAsset.count({
        where: {
          ownerId,
          deletedAt: null,
          ...privateVisibilityWhere(includePrivate),
          ...buildEagleFilterWhere(query),
        },
      }),
    };
  }

  async getAsset(
    ownerId: string,
    assetId: string,
    options: { trash?: boolean; includePrivate?: boolean } = {},
  ) {
    const { trash = false, includePrivate = false } = options;
    const asset = await this.prisma.eagleAsset.findFirst({
      where: {
        ownerId,
        id: assetId,
        deletedAt: trash ? { not: null } : null,
        purgeAfter: trash ? null : undefined,
        ...privateVisibilityWhere(includePrivate),
      },
      include: assetInclude,
    });
    if (!asset) throw new NotFoundException('素材不存在。');
    return serializeAsset(asset);
  }

  async updateAsset(
    ownerId: string,
    assetId: string,
    input: UpdateEagleAssetDto,
    includePrivate = false,
  ) {
    const { data, annotation } = buildAssetChanges(input);
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.eagleAsset.updateMany({
        where: {
          ownerId,
          id: assetId,
          deletedAt: null,
          rowVersion: input.rowVersion,
          ...privateVisibilityWhere(includePrivate),
        },
        data: { ...data, rowVersion: { increment: 1 } },
      });
      if (updated.count !== 1) await this.throwAssetWriteError(transaction, ownerId, assetId);
      if (annotation) {
        await transaction.eagleAssetAnnotation.upsert({
          where: { ownerId_assetId: { ownerId, assetId } },
          create: { ownerId, assetId, ...annotation },
          update: annotation,
        });
      }
    });
    return this.getAsset(ownerId, assetId, { includePrivate });
  }

  listUpdates(ownerId: string, assetIds: string[], includePrivate = false) {
    return this.prisma.eagleAsset
      .findMany({
        where: {
          ownerId,
          id: { in: assetIds },
          deletedAt: null,
          ...privateVisibilityWhere(includePrivate),
        },
        select: {
          id: true,
          lifecycleStatus: true,
          mediaErrorCode: true,
          updatedAt: true,
          renditions: {
            where: { status: 'READY' },
            orderBy: [{ revision: 'desc' as const }, { kind: 'asc' as const }],
            select: {
              id: true,
              kind: true,
              revision: true,
              mimeType: true,
              byteSize: true,
              width: true,
              height: true,
            },
          },
        },
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          renditions: row.renditions.map((rendition) => ({
            ...rendition,
            byteSize: Number(rendition.byteSize),
          })),
        })),
      );
  }

  async batchUpdate(ownerId: string, input: BatchUpdateEagleAssetsDto, includePrivate = false) {
    const { data, annotation } = buildAssetChanges(input);
    const updatedAssets = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.eagleAsset.findMany({
        where: {
          ownerId,
          id: { in: input.assets.map(({ assetId }) => assetId) },
          deletedAt: null,
          ...privateVisibilityWhere(includePrivate),
        },
        select: { id: true, rowVersion: true },
      });
      if (current.length !== input.assets.length)
        throw new NotFoundException('一个或多个素材不存在。');
      const versions = new Map(current.map((asset) => [asset.id, asset.rowVersion]));
      if (input.assets.some((asset) => versions.get(asset.assetId) !== asset.rowVersion)) {
        throw new ConflictException('一个或多个素材已被其他操作更新，请刷新后重试。');
      }
      const updated = await transaction.eagleAsset.updateMany({
        where: {
          ownerId,
          deletedAt: null,
          ...privateVisibilityWhere(includePrivate),
          OR: input.assets.map(({ assetId, rowVersion }) => ({ id: assetId, rowVersion })),
        },
        data: { ...data, rowVersion: { increment: 1 } },
      });
      if (updated.count !== input.assets.length) {
        throw new ConflictException('一个或多个素材已被其他操作更新，请刷新后重试。');
      }
      if (annotation) {
        for (const { assetId } of input.assets) {
          await transaction.eagleAssetAnnotation.upsert({
            where: { ownerId_assetId: { ownerId, assetId } },
            create: { ownerId, assetId, ...annotation },
            update: annotation,
          });
        }
      }
      return current.map(({ id, rowVersion }) => ({ assetId: id, rowVersion: rowVersion + 1 }));
    });
    return { affectedAssetCount: updatedAssets.length, assets: updatedAssets };
  }

  async batchSetPrivacy(
    ownerId: string,
    input: BatchSetEagleAssetPrivacyDto,
    includePrivate = false,
  ) {
    const current = await this.prisma.eagleAsset.findMany({
      where: {
        ownerId,
        id: { in: input.assets.map(({ assetId }) => assetId) },
        deletedAt: null,
        ...privateVisibilityWhere(includePrivate),
      },
      select: { id: true, rowVersion: true },
    });
    if (current.length !== input.assets.length) {
      throw new NotFoundException('一个或多个素材不存在。');
    }
    const versions = new Map(current.map(({ id, rowVersion }) => [id, rowVersion]));
    if (input.assets.some(({ assetId, rowVersion }) => versions.get(assetId) !== rowVersion)) {
      throw new ConflictException('一个或多个素材已被其他操作更新，请刷新后重试。');
    }
    const updated = await this.prisma.eagleAsset.updateMany({
      where: {
        ownerId,
        deletedAt: null,
        OR: input.assets.map(({ assetId, rowVersion }) => ({ id: assetId, rowVersion })),
        ...privateVisibilityWhere(includePrivate),
      },
      data: { isPrivate: input.isPrivate, rowVersion: { increment: 1 } },
    });
    if (updated.count !== input.assets.length) {
      throw new ConflictException('一个或多个素材已被其他操作更新，请刷新后重试。');
    }
    return {
      affectedAssetCount: updated.count,
      assets: current.map(({ id, rowVersion }) => ({ assetId: id, rowVersion: rowVersion + 1 })),
    };
  }

  async batchChangeManualTags(
    ownerId: string,
    input: BatchChangeEagleManualTagsDto,
    includePrivate = false,
  ) {
    const tagIds = [...new Set([...input.addTagIds, ...input.removeTagIds])];
    const [assets, tags] = await Promise.all([
      this.prisma.eagleAsset.findMany({
        where: {
          ownerId,
          id: { in: input.assetIds },
          deletedAt: null,
          ...privateVisibilityWhere(includePrivate),
        },
        select: { id: true },
      }),
      this.prisma.eagleManualTag.findMany({
        where: { ownerId, id: { in: tagIds } },
        select: { id: true },
      }),
    ]);
    if (assets.length !== input.assetIds.length || tags.length !== tagIds.length) {
      throw new NotFoundException('一个或多个素材或标签不存在。');
    }
    await this.prisma.$transaction(async (transaction) => {
      if (input.removeTagIds.length) {
        await transaction.eagleAssetManualTag.deleteMany({
          where: { ownerId, assetId: { in: input.assetIds }, tagId: { in: input.removeTagIds } },
        });
        await transaction.eagleTagMemberDistance.deleteMany({
          where: { ownerId, assetId: { in: input.assetIds }, tagId: { in: input.removeTagIds } },
        });
      }
      if (input.addTagIds.length) {
        await transaction.eagleAssetManualTag.updateMany({
          where: { ownerId, assetId: { in: input.assetIds }, tagId: { in: input.addTagIds } },
          data: { assignedByUser: true },
        });
        await transaction.eagleAssetManualTag.createMany({
          data: input.assetIds.flatMap((assetId) =>
            input.addTagIds.map((tagId) => ({ ownerId, assetId, tagId })),
          ),
          skipDuplicates: true,
        });
        await syncCurrentTagMemberDistances(transaction, ownerId, input.assetIds, input.addTagIds);
      }
    });
    return { affectedAssetCount: input.assetIds.length };
  }

  async setTrash(ownerId: string, assetIds: string[], restore: boolean, includePrivate = false) {
    const ids = [...new Set(assetIds)];
    if (ids.length !== assetIds.length) throw new BadRequestException('素材 ID 不能重复。');
    const affectedAssetCount = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.eagleAsset.updateMany({
        where: {
          ownerId,
          id: { in: ids },
          deletedAt: restore ? { not: null } : null,
          purgeAfter: restore ? null : undefined,
          ...privateVisibilityWhere(includePrivate),
        },
        data: {
          deletedAt: restore ? null : new Date(),
          purgeAfter: null,
          rowVersion: { increment: 1 },
        },
      });
      if (result.count !== ids.length) throw new NotFoundException('一个或多个素材不存在。');
      return result.count;
    });
    return { affectedAssetCount };
  }

  async emptyTrash(ownerId: string) {
    const affectedAssetCount = await this.prisma.$transaction(async (transaction) => {
      const purgeAfter = new Date();
      const assets = await transaction.$queryRaw<Array<{ id: string; mediaRevision: number }>>(
        Prisma.sql`
          UPDATE "EagleAsset"
          SET "purgeAfter" = ${purgeAfter}, "rowVersion" = "rowVersion" + 1,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "ownerId" = ${ownerId} AND "deletedAt" IS NOT NULL AND "purgeAfter" IS NULL
          RETURNING "id", "mediaRevision"
        `,
      );
      if (!assets.length) return 0;
      await transaction.eagleAssetProcessingJob.createMany({
        data: assets.map((asset) => ({
          ownerId,
          assetId: asset.id,
          kind: 'PURGE_ASSET' as const,
          lane: 'MAINTENANCE' as const,
          assetRevision: asset.mediaRevision,
        })),
        skipDuplicates: true,
      });
      return assets.length;
    });
    return { affectedAssetCount };
  }

  async listManualTags(ownerId: string, includePrivate = false) {
    const tags = await this.prisma.eagleManualTag.findMany({
      where: { ownerId },
      orderBy: [{ isStarred: 'desc' }, { normalizedName: 'asc' }],
      select: {
        id: true,
        name: true,
        color: true,
        groupId: true,
        groupMemberships: { orderBy: { groupId: 'asc' }, select: { groupId: true } },
        isStarred: true,
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
        },
        select: { id: true, name: true, color: true, isStarred: true, rowVersion: true },
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
  ) {
    const current = await this.prisma.eagleManualTag.findFirst({ where: { ownerId, id: tagId } });
    if (!current) throw new NotFoundException('标签不存在。');
    const name =
      input.name === undefined ? current.name : normalizeName(input.name, 64, '标签名称');
    if (
      input.groupId &&
      !(await this.prisma.eagleManualTagGroup.count({ where: { ownerId, id: input.groupId } }))
    )
      throw new NotFoundException('标签组不存在。');
    try {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.eagleManualTag.updateMany({
          where: { ownerId, id: tagId, rowVersion: input.rowVersion },
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
          await transaction.eagleManualTagGroupMembership.deleteMany({ where: { ownerId, tagId } });
          if (input.groupId) {
            await transaction.eagleManualTagGroupMembership.create({
              data: { ownerId, tagId, groupId: input.groupId },
            });
          }
        }
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('标签名称已存在。');
      throw error;
    }
    const tag = await this.prisma.eagleManualTag.findFirstOrThrow({
      where: { ownerId, id: tagId },
      select: {
        id: true,
        name: true,
        color: true,
        groupId: true,
        groupMemberships: { orderBy: { groupId: 'asc' }, select: { groupId: true } },
        isStarred: true,
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

  async deleteManualTag(ownerId: string, tagId: string) {
    const tag = await this.prisma.eagleManualTag.findFirst({
      where: { ownerId, id: tagId },
      select: { id: true },
    });
    if (!tag) throw new NotFoundException('标签不存在。');
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.eagleAssetManualTag.deleteMany({ where: { ownerId, tagId } });
        await transaction.eagleManualTag.delete({ where: { id: tagId } });
      });
      return { deletedId: tagId };
    } catch (error) {
      if (isForeignKeyError(error))
        throw new ConflictException('标签正在被智能文件夹使用，无法删除。');
      throw error;
    }
  }

  async listManualTagGroups(ownerId: string) {
    const groups = await this.prisma.eagleManualTagGroup.findMany({
      where: { ownerId },
      orderBy: { normalizedName: 'asc' },
      include: { _count: { select: { tagMemberships: true } } },
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
      where: { ownerId, id: groupId },
    });
    if (!current) throw new NotFoundException('标签组不存在。');
    const name =
      input.name === undefined ? current.name : normalizeName(input.name, 64, '标签组名称');
    try {
      const result = await this.prisma.eagleManualTagGroup.updateMany({
        where: { ownerId, id: groupId, rowVersion: input.rowVersion },
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
        where: { ownerId, id: groupId },
        include: { _count: { select: { tagMemberships: true } } },
      });
      const { _count, ...fields } = group;
      return { ...fields, tagCount: _count.tagMemberships };
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('标签组名称已存在。');
      throw error;
    }
  }

  async deleteManualTagGroup(ownerId: string, groupId: string) {
    const group = await this.prisma.eagleManualTagGroup.findFirst({
      where: { ownerId, id: groupId },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('标签组不存在。');
    await this.prisma.$transaction(async (transaction) => {
      await transaction.eagleManualTag.updateMany({
        where: { ownerId, groupId },
        data: { groupId: null, rowVersion: { increment: 1 } },
      });
      await transaction.eagleManualTagGroup.delete({ where: { id: groupId } });
    });
    return { deletedId: groupId };
  }

  async listAiTags(ownerId: string, includePrivate = false) {
    const tags = await this.prisma.eagleAiTag.findMany({
      where: { ownerId },
      orderBy: { normalizedName: 'asc' },
      include: {
        _count: {
          select: {
            assetLinks: {
              where: {
                status: 'ACTIVE',
                asset: { deletedAt: null, ...privateVisibilityWhere(includePrivate) },
              },
            },
          },
        },
      },
    });
    return tags.map(({ _count, ...tag }) => ({
      ...tag,
      assetCount: _count.assetLinks,
      ...createEagleTagPhonetics(tag.name),
    }));
  }

  async replaceAssetTags(
    ownerId: string,
    assetId: string,
    tagIds: string[],
    includePrivate = false,
  ) {
    const ids = [...new Set(tagIds)];
    if (ids.length !== tagIds.length) throw new BadRequestException('标签不能重复。');
    await this.prisma.$transaction(async (transaction) => {
      const [asset, tagCount] = await Promise.all([
        transaction.eagleAsset.findFirst({
          where: {
            ownerId,
            id: assetId,
            deletedAt: null,
            ...privateVisibilityWhere(includePrivate),
          },
          select: { id: true },
        }),
        transaction.eagleManualTag.count({ where: { ownerId, id: { in: ids } } }),
      ]);
      if (!asset || tagCount !== ids.length) throw new NotFoundException('素材或标签不存在。');
      await transaction.eagleAssetManualTag.deleteMany({ where: { ownerId, assetId } });
      await transaction.eagleTagMemberDistance.deleteMany({ where: { ownerId, assetId } });
      if (ids.length) {
        await transaction.eagleAssetManualTag.createMany({
          data: ids.map((tagId) => ({ ownerId, assetId, tagId, assignedByUser: true })),
        });
        await syncCurrentTagMemberDistances(transaction, ownerId, [assetId], ids);
      }
    });
    return this.getAsset(ownerId, assetId, { includePrivate });
  }

  listSmartFolders(ownerId: string) {
    return this.prisma.eagleSmartFolder.findMany({
      where: { ownerId },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
    });
  }

  async createSmartFolder(ownerId: string, input: CreateSmartFolderDto) {
    const parent = await this.resolveParent(ownerId, input.parentId);
    const name = normalizeName(input.name, 64, '智能文件夹名称');
    const position = await this.prisma.eagleSmartFolder.aggregate({
      where: { ownerId, parentId: parent?.id ?? null },
      _max: { position: true },
    });
    const queryJson = normalizeSmartFolderQuery(input.query, 'ANY');
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
          },
        });
        await this.replaceSmartFolderDependencies(transaction, ownerId, folder.id, dependencies);
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
      where: { ownerId, id: folderId },
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
      where: { ownerId, parentId: folderId },
    });
    if (input.parentId !== undefined && parent && childCount > 0)
      throw new BadRequestException('已有子级的文件夹不能继续嵌套。');
    const name =
      input.name === undefined ? current.name : normalizeName(input.name, 64, '智能文件夹名称');
    const queryJson =
      input.query === undefined ? undefined : normalizeSmartFolderQuery(input.query);
    const dependencies = queryJson ? readSmartFolderDependencies(queryJson) : null;
    if (dependencies) await this.assertSmartFolderTagDependencies(ownerId, dependencies);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const result = await transaction.eagleSmartFolder.updateMany({
          where: { ownerId, id: folderId, rowVersion: input.rowVersion },
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
          await Promise.all([
            transaction.eagleSmartFolderManualTagDependency.deleteMany({
              where: { ownerId, smartFolderId: folderId },
            }),
            transaction.eagleSmartFolderAiTagDependency.deleteMany({
              where: { ownerId, smartFolderId: folderId },
            }),
          ]);
          await this.replaceSmartFolderDependencies(transaction, ownerId, folderId, dependencies);
        }
        return transaction.eagleSmartFolder.findFirstOrThrow({ where: { ownerId, id: folderId } });
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
          where: { ownerId, id: folderId },
          select: { id: true, parentId: true, position: true },
        });
        if (!folder) throw new NotFoundException('智能文件夹不存在。');
        const parent = input.parentId
          ? await transaction.eagleSmartFolder.findFirst({
              where: { ownerId, id: input.parentId },
              select: { id: true, parentId: true },
            })
          : null;
        if (input.parentId && !parent) throw new NotFoundException('父级智能文件夹不存在。');
        if (parent?.parentId) throw new BadRequestException('智能文件夹最多两层。');
        if (
          parent &&
          (await transaction.eagleSmartFolder.count({ where: { ownerId, parentId: folderId } }))
        )
          throw new BadRequestException('已有子级的文件夹不能继续嵌套。');

        const destinationSiblingCount = await transaction.eagleSmartFolder.count({
          where: { ownerId, parentId: input.parentId ?? null, id: { not: folderId } },
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
            },
            data: { position: { decrement: 1 } },
          });
          await transaction.eagleSmartFolder.updateMany({
            where: {
              ownerId,
              parentId: input.parentId ?? null,
              id: { not: folderId },
              position: { gte: destinationPosition },
            },
            data: { position: { increment: 1 } },
          });
        }
        const result = await transaction.eagleSmartFolder.updateMany({
          where: { ownerId, id: folderId, rowVersion: input.rowVersion },
          data: {
            parentId: input.parentId ?? null,
            position: destinationPosition,
            rowVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new ConflictException('智能文件夹已被更新，请刷新后重试。');
        return transaction.eagleSmartFolder.findFirstOrThrow({ where: { ownerId, id: folderId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async deleteSmartFolder(ownerId: string, folderId: string) {
    if (await this.prisma.eagleSmartFolder.count({ where: { ownerId, parentId: folderId } })) {
      throw new ConflictException('请先删除或移出子级智能文件夹。');
    }
    const result = await this.prisma.eagleSmartFolder.deleteMany({
      where: { ownerId, id: folderId },
    });
    if (result.count !== 1) throw new NotFoundException('智能文件夹不存在。');
    return { id: folderId };
  }

  private async resolveParent(ownerId: string, parentId: string | null | undefined) {
    if (!parentId) return null;
    const parent = await this.prisma.eagleSmartFolder.findFirst({
      where: { ownerId, id: parentId },
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
    const [manualTagCount, aiTagCount] = await Promise.all([
      this.prisma.eagleManualTag.count({
        where: { ownerId, id: { in: dependencies.manualTagIds } },
      }),
      this.prisma.eagleAiTag.count({ where: { ownerId, id: { in: dependencies.aiTagIds } } }),
    ]);
    if (manualTagCount !== dependencies.manualTagIds.length)
      throw new NotFoundException('一个或多个人工标签不存在。');
    if (aiTagCount !== dependencies.aiTagIds.length)
      throw new NotFoundException('一个或多个 AI 标签不存在。');
  }

  private async replaceSmartFolderDependencies(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    folderId: string,
    dependencies: SmartFolderDependencies,
  ) {
    if (dependencies.manualTagIds.length) {
      await transaction.eagleSmartFolderManualTagDependency.createMany({
        data: dependencies.manualTagIds.map((manualTagId) => ({
          ownerId,
          smartFolderId: folderId,
          manualTagId,
        })),
      });
    }
    if (dependencies.aiTagIds.length) {
      await transaction.eagleSmartFolderAiTagDependency.createMany({
        data: dependencies.aiTagIds.map((aiTagId) => ({
          ownerId,
          smartFolderId: folderId,
          aiTagId,
        })),
      });
    }
  }

  private async throwAssetWriteError(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    assetId: string,
  ): Promise<never> {
    const exists = await transaction.eagleAsset.findFirst({
      where: { ownerId, id: assetId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('素材不存在。');
    throw new ConflictException('素材已被其他操作更新，请刷新后重试。');
  }

  private async throwTagWriteError(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    tagId: string,
  ): Promise<never> {
    if (!(await transaction.eagleManualTag.count({ where: { ownerId, id: tagId } })))
      throw new NotFoundException('标签不存在。');
    throw new ConflictException('标签已被其他操作更新，请刷新后重试。');
  }

  private async throwFolderWriteError(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    folderId: string,
  ): Promise<never> {
    if (!(await transaction.eagleSmartFolder.count({ where: { ownerId, id: folderId } })))
      throw new NotFoundException('智能文件夹不存在。');
    throw new ConflictException('智能文件夹已被其他操作更新，请刷新后重试。');
  }
}

function serializeAsset(asset: AssetRecord) {
  const { annotation, aiTagLinks, colorAnalyses, ...listRecord } = asset;
  return {
    ...serializeAssetList(listRecord),
    annotation,
    aiTags: aiTagLinks.map(({ aiTag, confidence, status }) => ({ ...aiTag, confidence, status })),
    colorAnalysis: colorAnalyses[0]
      ? {
          assetRevision: colorAnalyses[0].assetRevision,
          processorVersion: colorAnalyses[0].processorVersion,
          status: colorAnalyses[0].status,
          lastError: colorAnalyses[0].lastError,
          completedAt: colorAnalyses[0].completedAt,
          swatches: colorAnalyses[0].swatches,
        }
      : null,
  };
}

function serializeAssetList(asset: AssetListRecord) {
  const { manualTagLinks, ...record } = asset;
  const safe = { ...record, originalObjectKey: undefined };
  return {
    ...safe,
    byteSize: Number(asset.byteSize),
    originalUrl: `/api/eagle/assets/${asset.id}/original`,
    renditions: asset.renditions.map((rendition) => ({
      ...rendition,
      byteSize: Number(rendition.byteSize),
      url: `/api/eagle/assets/${asset.id}/renditions/${rendition.id}`,
    })),
    manualTags: manualTagLinks.map(({ tag }) => tag),
  };
}

type StoredAssetFilters = Partial<ListEagleAssetsDto> & {
  tagMatch?: 'ANY' | 'ALL';
};

function readSmartFolderFilters(value: Prisma.JsonValue): StoredAssetFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const root = value as Record<string, Prisma.JsonValue>;
  const candidate =
    root.filters && typeof root.filters === 'object' && !Array.isArray(root.filters)
      ? root.filters
      : root;
  const filters = candidate as StoredAssetFilters & { assetColor?: string };
  return { ...filters, color: filters.color ?? filters.assetColor };
}

function isEagleFilterQuery(value: Prisma.JsonValue): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, Prisma.JsonValue>).version === EAGLE_FILTER_QUERY_VERSION,
  );
}

function parseEncodedFilterQuery(value: string): EagleFilterQuery {
  try {
    return readEagleFilterQuery(JSON.parse(value) as unknown);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('筛选规则 JSON 无效。');
  }
}

function readFilterColor(query: EagleFilterQuery | null): string | undefined {
  for (const condition of query?.conditions ?? []) {
    const colorRule = condition.rules.find(
      (rule) => rule.field === 'COLOR' && typeof rule.value === 'string',
    );
    if (typeof colorRule?.value === 'string') return colorRule.value;
  }
  return undefined;
}

function readStoredFilterColor(query: Prisma.JsonValue): string | undefined {
  return isEagleFilterQuery(query)
    ? readFilterColor(readEagleFilterQuery(query))
    : readSmartFolderFilters(query).color;
}

function buildStoredSmartFolderWhere(
  ownerId: string,
  query: Prisma.JsonValue,
  trash: boolean,
  includePrivate: boolean,
): Prisma.EagleAssetWhereInput {
  return isEagleFilterQuery(query)
    ? {
        ownerId,
        deletedAt: trash ? { not: null } : null,
        ...(trash ? { purgeAfter: null } : {}),
        ...privateVisibilityWhere(includePrivate),
        ...buildEagleFilterWhere(readEagleFilterQuery(query)),
      }
    : buildAssetWhere(ownerId, readSmartFolderFilters(query), trash, includePrivate);
}

function buildAssetWhere(
  ownerId: string,
  filters: StoredAssetFilters,
  trash: boolean,
  includePrivate: boolean,
): Prisma.EagleAssetWhereInput {
  const conditions: Prisma.EagleAssetWhereInput[] = [];
  const search = filters.search?.normalize('NFKC').trim();
  if (search) {
    const normalizedSearch = normalizeKey(search);
    conditions.push({
      OR: [
        { normalizedDisplayName: { contains: normalizedSearch } },
        { originalName: { contains: search, mode: 'insensitive' } },
        { manualTagLinks: { some: { tag: { normalizedName: { contains: normalizedSearch } } } } },
        {
          aiTagLinks: {
            some: {
              status: 'ACTIVE',
              aiTag: { normalizedName: { contains: normalizedSearch } },
            },
          },
        },
      ],
    });
  }
  const formats = filters.formats?.length
    ? filters.formats
    : filters.format
      ? [filters.format]
      : [];
  if (formats.length)
    conditions.push({ format: { in: formats.map((value) => value.toLowerCase()) } });
  const tagConditions: Prisma.EagleAssetWhereInput[] = [
    ...(filters.manualTagIds ?? []).map((tagId) => ({ manualTagLinks: { some: { tagId } } })),
    ...(filters.aiTagIds ?? []).map((aiTagId) => ({
      aiTagLinks: { some: { aiTagId, status: 'ACTIVE' as const } },
    })),
  ];
  if (tagConditions.length) {
    if (filters.tagMatch === 'ANY') conditions.push({ OR: tagConditions });
    else conditions.push(...tagConditions);
  }
  if (filters.rating !== undefined) conditions.push({ rating: { gte: filters.rating } });
  const width = rangeFilter(filters.minWidth, filters.maxWidth);
  if (width) conditions.push({ width });
  const height = rangeFilter(filters.minHeight, filters.maxHeight);
  if (height) conditions.push({ height });
  const libraryAddedAt = dateRangeFilter(filters.createdFrom, filters.createdTo);
  if (libraryAddedAt) conditions.push({ libraryAddedAt });
  if (filters.color) conditions.push({ colorAnalyses: buildColorAnalysisWhere(filters.color) });
  if (filters.privacy === 'PRIVATE' && !includePrivate) conditions.push({ isPrivate: true });
  return {
    ownerId,
    deletedAt: trash ? { not: null } : null,
    ...(trash ? { purgeAfter: null } : {}),
    ...(filters.privacy === 'PRIVATE' && includePrivate
      ? { isPrivate: true }
      : privateVisibilityWhere(includePrivate)),
    ...(conditions.length ? { AND: conditions } : {}),
  };
}

function privateVisibilityWhere(includePrivate: boolean): { isPrivate?: false } {
  return includePrivate ? {} : { isPrivate: false };
}

function omitRepeatedSmartFolderFilters(
  query: StoredAssetFilters,
  folderQueries: StoredAssetFilters[],
): StoredAssetFilters {
  if (!folderQueries.length) return query;
  const result = { ...query };
  for (const key of ['formats', 'manualTagIds', 'aiTagIds'] as const) {
    const requested = [...new Set(result[key] ?? [])];
    if (!requested.length) continue;
    const folderValues = folderQueries.map((folder) => new Set(folder[key] ?? []));
    if (key === 'formats') {
      if (folderValues.every((values) => equalStringSets(new Set(requested), values))) {
        delete result[key];
      } else result[key] = requested;
      continue;
    }
    const remaining = requested.filter(
      (value) => !folderValues.every((values) => values.has(value)),
    );
    if (remaining.length) result[key] = remaining;
    else delete result[key];
  }
  for (const key of [
    'search',
    'color',
    'rating',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'createdFrom',
    'createdTo',
  ] as const) {
    const value = result[key];
    if (value !== undefined && folderQueries.every((folder) => folder[key] === value)) {
      delete result[key];
    }
  }
  return result;
}

function equalStringSets(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function rangeFilter(minimum?: number, maximum?: number): Prisma.IntNullableFilter | undefined {
  if (minimum === undefined && maximum === undefined) return undefined;
  return { gte: minimum, lte: maximum };
}

function dateRangeFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime())))
    throw new BadRequestException('日期筛选无效。');
  return { gte: start, lte: end };
}

function normalizeName(value: string, maxLength: number, label: string): string {
  const name = value.normalize('NFKC').trim();
  if (!name || name.length > maxLength) throw new BadRequestException(`${label}长度无效。`);
  return name;
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new BadRequestException('颜色值无效。');
  return color;
}

type AnnotationData = {
  color?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
};

function buildAssetChanges(input: {
  displayName?: string;
  rating?: number | null;
  color?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
}) {
  const data: Prisma.EagleAssetUpdateManyMutationInput = {};
  if (input.displayName !== undefined) {
    const displayName = normalizeName(input.displayName, 255, '素材名称');
    data.displayName = displayName;
    data.normalizedDisplayName = normalizeKey(displayName);
  }
  if (input.rating !== undefined) {
    if (input.rating !== null && ![1, 2, 3, 4, 5].includes(input.rating)) {
      throw new BadRequestException('星级只能是 1 到 5，或留空。');
    }
    data.rating = input.rating;
  }
  const annotation = normalizeAnnotation(input);
  if (!Object.keys(data).length && !annotation)
    throw new BadRequestException('没有可更新的素材信息。');
  return { data, annotation };
}

function normalizeAnnotation(input: {
  color?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
}): AnnotationData | null {
  if (input.color === undefined && input.description === undefined && input.sourceUrl === undefined)
    return null;
  const annotation: AnnotationData = {};
  if (input.color !== undefined) annotation.color = normalizeColor(input.color);
  if (input.description !== undefined)
    annotation.description = input.description?.normalize('NFKC').trim() || null;
  if (input.sourceUrl !== undefined) {
    if (!input.sourceUrl) annotation.sourceUrl = null;
    else {
      try {
        const url = new URL(input.sourceUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported');
        annotation.sourceUrl = url.toString();
      } catch {
        throw new BadRequestException('素材来源必须是 HTTP 或 HTTPS 地址。');
      }
    }
  }
  return annotation;
}

function normalizeSmartFolderQuery(
  query: Record<string, unknown>,
  defaultTagMatch?: 'ANY' | 'ALL',
): Prisma.InputJsonValue {
  if (query.version === EAGLE_FILTER_QUERY_VERSION) {
    return JSON.parse(JSON.stringify(readEagleFilterQuery(query))) as Prisma.InputJsonObject;
  }
  const candidate =
    query.version === 1 && query.filters && typeof query.filters === 'object'
      ? (query.filters as Record<string, unknown>)
      : query;
  const allowed = [
    'search',
    'rating',
    'format',
    'formats',
    'manualTagIds',
    'aiTagIds',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'createdFrom',
    'createdTo',
    'assetColor',
    'tagMatch',
  ];
  if (Object.keys(candidate).some((key) => !allowed.includes(key)))
    throw new BadRequestException('智能文件夹包含不支持的条件。');
  const filters = { ...candidate };
  if (defaultTagMatch && filters.tagMatch === undefined) filters.tagMatch = defaultTagMatch;
  if (
    filters.tagMatch !== undefined &&
    (typeof filters.tagMatch !== 'string' || !['ANY', 'ALL'].includes(filters.tagMatch))
  )
    throw new BadRequestException('智能文件夹标签匹配方式无效。');
  for (const key of ['manualTagIds', 'aiTagIds'] as const) {
    if (filters[key] !== undefined) readUniqueStringArray(filters[key], key);
  }
  return { version: 1, filters: JSON.parse(JSON.stringify(filters)) as Prisma.InputJsonObject };
}

type SmartFolderDependencies = { manualTagIds: string[]; aiTagIds: string[] };

function readSmartFolderDependencies(query: Prisma.InputJsonValue): SmartFolderDependencies {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new BadRequestException('智能文件夹条件无效。');
  const root = query as Prisma.InputJsonObject;
  if (root.version === EAGLE_FILTER_QUERY_VERSION) {
    return readEagleFilterTagDependencies(readEagleFilterQuery(root));
  }
  const filters = root.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters))
    throw new BadRequestException('智能文件夹条件无效。');
  const record = filters as Prisma.InputJsonObject;
  return {
    manualTagIds: readUniqueStringArray(record.manualTagIds, '人工标签'),
    aiTagIds: readUniqueStringArray(record.aiTagIds, 'AI 标签'),
  };
}

function readStoredQueryVersion(query: Prisma.InputJsonValue): number {
  return query &&
    typeof query === 'object' &&
    !Array.isArray(query) &&
    (query as Prisma.InputJsonObject).version === 2
    ? 2
    : 1;
}

function readUniqueStringArray(
  value: Prisma.InputJsonValue | null | undefined,
  label: string,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
    throw new BadRequestException(`${label}条件无效。`);
  return [...new Set(value as string[])];
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isForeignKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}
