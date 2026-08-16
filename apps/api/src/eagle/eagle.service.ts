import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateManualTagDto,
  CreateSmartFolderDto,
  ListEagleAssetsDto,
  MoveSmartFolderDto,
  UpdateEagleAssetDto,
  UpdateManualTagDto,
  UpdateSmartFolderDto,
} from './eagle.dto';

const assetInclude = Prisma.validator<Prisma.EagleAssetInclude>()({
  annotation: { select: { color: true, description: true, sourceUrl: true } },
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

type AssetRecord = Prisma.EagleAssetGetPayload<{ include: typeof assetInclude }>;

@Injectable()
export class EagleService {
  constructor(private readonly prisma: PrismaService) {}

  async listAssets(ownerId: string, query: ListEagleAssetsDto, trash = false) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const where: Prisma.EagleAssetWhereInput = {
      ownerId,
      deletedAt: trash ? { not: null } : null,
      purgeAfter: trash ? null : undefined,
      rating: query.rating,
      format: query.format ? query.format.toLowerCase() : undefined,
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { originalName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(cursor
        ? {
            AND: [
              {
                OR: [
                  { libraryAddedAt: { lt: cursor.libraryAddedAt } },
                  { libraryAddedAt: cursor.libraryAddedAt, id: { lt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.eagleAsset.findMany({
      where,
      include: assetInclude,
      orderBy: [{ libraryAddedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(serializeAsset),
      nextCursor: hasMore && page.length ? encodeCursor(page.at(-1)!) : null,
    };
  }

  async getAsset(ownerId: string, assetId: string, trash = false) {
    const asset = await this.prisma.eagleAsset.findFirst({
      where: {
        ownerId,
        id: assetId,
        deletedAt: trash ? { not: null } : null,
        purgeAfter: trash ? null : undefined,
      },
      include: assetInclude,
    });
    if (!asset) throw new NotFoundException('素材不存在。');
    return serializeAsset(asset);
  }

  async updateAsset(ownerId: string, assetId: string, input: UpdateEagleAssetDto) {
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
    if (Object.keys(data).length === 0 && !annotation) {
      throw new BadRequestException('没有可更新的素材信息。');
    }
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.eagleAsset.updateMany({
        where: { ownerId, id: assetId, deletedAt: null, rowVersion: input.rowVersion },
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
    return this.getAsset(ownerId, assetId);
  }

  async setTrash(ownerId: string, assetIds: string[], restore: boolean) {
    const ids = [...new Set(assetIds)];
    if (ids.length !== assetIds.length) throw new BadRequestException('素材 ID 不能重复。');
    const result = await this.prisma.eagleAsset.updateMany({
      where: {
        ownerId,
        id: { in: ids },
        deletedAt: restore ? { not: null } : null,
        purgeAfter: restore ? null : undefined,
      },
      data: { deletedAt: restore ? null : new Date(), rowVersion: { increment: 1 } },
    });
    if (result.count !== ids.length) throw new NotFoundException('一个或多个素材不存在。');
    return { affectedAssetCount: result.count };
  }

  async emptyTrash(ownerId: string) {
    const result = await this.prisma.eagleAsset.updateMany({
      where: { ownerId, deletedAt: { not: null }, purgeAfter: null },
      data: { purgeAfter: new Date(), rowVersion: { increment: 1 } },
    });
    return { affectedAssetCount: result.count };
  }

  async listManualTags(ownerId: string) {
    return this.prisma.eagleManualTag.findMany({
      where: { ownerId },
      orderBy: [{ isStarred: 'desc' }, { normalizedName: 'asc' }],
      select: {
        id: true,
        name: true,
        color: true,
        isStarred: true,
        rowVersion: true,
        _count: { select: { assetLinks: true } },
      },
    });
  }

  async createManualTag(ownerId: string, input: CreateManualTagDto) {
    const name = normalizeName(input.name, 100, '标签名称');
    try {
      return await this.prisma.eagleManualTag.create({
        data: {
          ownerId,
          name,
          normalizedName: normalizeKey(name),
          color: normalizeColor(input.color),
        },
        select: { id: true, name: true, color: true, isStarred: true, rowVersion: true },
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('标签名称已存在。');
      throw error;
    }
  }

  async updateManualTag(ownerId: string, tagId: string, input: UpdateManualTagDto) {
    const name = normalizeName(input.name, 100, '标签名称');
    const updated = await this.prisma.eagleManualTag.updateMany({
      where: { ownerId, id: tagId, rowVersion: input.rowVersion },
      data: {
        name,
        normalizedName: normalizeKey(name),
        color: normalizeColor(input.color),
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) await this.throwTagWriteError(ownerId, tagId);
    return this.prisma.eagleManualTag.findFirstOrThrow({ where: { ownerId, id: tagId } });
  }

  async deleteManualTag(ownerId: string, tagId: string) {
    const result = await this.prisma.eagleManualTag.deleteMany({ where: { ownerId, id: tagId } });
    if (result.count !== 1) throw new NotFoundException('标签不存在。');
    return { id: tagId };
  }

  async replaceAssetTags(ownerId: string, assetId: string, tagIds: string[]) {
    const ids = [...new Set(tagIds)];
    if (ids.length !== tagIds.length) throw new BadRequestException('标签不能重复。');
    await this.prisma.$transaction(async (transaction) => {
      const [asset, tagCount] = await Promise.all([
        transaction.eagleAsset.findFirst({
          where: { ownerId, id: assetId, deletedAt: null },
          select: { id: true },
        }),
        transaction.eagleManualTag.count({ where: { ownerId, id: { in: ids } } }),
      ]);
      if (!asset || tagCount !== ids.length) throw new NotFoundException('素材或标签不存在。');
      await transaction.eagleAssetManualTag.deleteMany({ where: { ownerId, assetId } });
      if (ids.length) {
        await transaction.eagleAssetManualTag.createMany({
          data: ids.map((tagId) => ({ ownerId, assetId, tagId, assignedByUser: true })),
        });
      }
    });
    return this.getAsset(ownerId, assetId);
  }

  listSmartFolders(ownerId: string) {
    return this.prisma.eagleSmartFolder.findMany({
      where: { ownerId },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
    });
  }

  async createSmartFolder(ownerId: string, input: CreateSmartFolderDto) {
    const parent = await this.resolveParent(ownerId, input.parentId);
    const name = normalizeName(input.name, 100, '智能文件夹名称');
    const position = await this.prisma.eagleSmartFolder.count({
      where: { ownerId, parentId: parent?.id ?? null },
    });
    try {
      return await this.prisma.eagleSmartFolder.create({
        data: {
          ownerId,
          parentId: parent?.id,
          name,
          normalizedName: normalizeKey(name),
          color: normalizeColor(input.color),
          queryJson: normalizeSmartFolderQuery(input.query),
          position,
        },
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('智能文件夹名称已存在。');
      throw error;
    }
  }

  async updateSmartFolder(ownerId: string, folderId: string, input: UpdateSmartFolderDto) {
    if (input.parentId === folderId)
      throw new BadRequestException('智能文件夹不能作为自己的父级。');
    const parent = await this.resolveParent(ownerId, input.parentId);
    const childCount = await this.prisma.eagleSmartFolder.count({
      where: { ownerId, parentId: folderId },
    });
    if (parent && childCount > 0) throw new BadRequestException('已有子级的文件夹不能继续嵌套。');
    const name = normalizeName(input.name, 100, '智能文件夹名称');
    const result = await this.prisma.eagleSmartFolder.updateMany({
      where: { ownerId, id: folderId, rowVersion: input.rowVersion },
      data: {
        parentId: parent?.id ?? null,
        name,
        normalizedName: normalizeKey(name),
        color: normalizeColor(input.color),
        queryJson: normalizeSmartFolderQuery(input.query),
        rowVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) await this.throwFolderWriteError(ownerId, folderId);
    return this.prisma.eagleSmartFolder.findFirstOrThrow({ where: { ownerId, id: folderId } });
  }

  async moveSmartFolder(ownerId: string, folderId: string, input: MoveSmartFolderDto) {
    if (input.parentId === folderId)
      throw new BadRequestException('智能文件夹不能作为自己的父级。');
    const folder = await this.prisma.eagleSmartFolder.findFirst({
      where: { ownerId, id: folderId },
    });
    if (!folder) throw new NotFoundException('智能文件夹不存在。');
    const parent = await this.resolveParent(ownerId, input.parentId);
    const childCount = await this.prisma.eagleSmartFolder.count({
      where: { ownerId, parentId: folderId },
    });
    if (parent && childCount > 0) throw new BadRequestException('已有子级的文件夹不能继续嵌套。');
    const result = await this.prisma.eagleSmartFolder.updateMany({
      where: { ownerId, id: folderId, rowVersion: input.rowVersion },
      data: {
        parentId: parent?.id ?? null,
        position: input.position,
        rowVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException('智能文件夹已被更新，请刷新后重试。');
    await this.normalizeFolderPositions(ownerId, parent?.id ?? null);
    return this.prisma.eagleSmartFolder.findFirstOrThrow({ where: { ownerId, id: folderId } });
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

  private async normalizeFolderPositions(ownerId: string, parentId: string | null) {
    const siblings = await this.prisma.eagleSmartFolder.findMany({
      where: { ownerId, parentId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    await this.prisma.$transaction(
      siblings.map(({ id }, position) =>
        this.prisma.eagleSmartFolder.update({ where: { id }, data: { position } }),
      ),
    );
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

  private async throwTagWriteError(ownerId: string, tagId: string): Promise<never> {
    if (!(await this.prisma.eagleManualTag.count({ where: { ownerId, id: tagId } })))
      throw new NotFoundException('标签不存在。');
    throw new ConflictException('标签已被其他操作更新，请刷新后重试。');
  }

  private async throwFolderWriteError(ownerId: string, folderId: string): Promise<never> {
    if (!(await this.prisma.eagleSmartFolder.count({ where: { ownerId, id: folderId } })))
      throw new NotFoundException('智能文件夹不存在。');
    throw new ConflictException('智能文件夹已被其他操作更新，请刷新后重试。');
  }
}

function serializeAsset(asset: AssetRecord) {
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

function encodeCursor(asset: Pick<AssetRecord, 'libraryAddedAt' | 'id'>): string {
  return Buffer.from(
    JSON.stringify({ at: asset.libraryAddedAt.toISOString(), id: asset.id }),
  ).toString('base64url');
}

function decodeCursor(cursor: string): { libraryAddedAt: Date; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      at?: unknown;
      id?: unknown;
    };
    const date = typeof value.at === 'string' ? new Date(value.at) : new Date(Number.NaN);
    if (Number.isNaN(date.getTime()) || typeof value.id !== 'string')
      throw new Error('invalid cursor');
    return { libraryAddedAt: date, id: value.id };
  } catch {
    throw new BadRequestException('素材游标无效。');
  }
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

function normalizeAnnotation(input: UpdateEagleAssetDto): AnnotationData | null {
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

function normalizeSmartFolderQuery(query: Record<string, unknown>): Prisma.InputJsonValue {
  const allowed = ['search', 'rating', 'format', 'manualTagIds'];
  if (Object.keys(query).some((key) => !allowed.includes(key)))
    throw new BadRequestException('智能文件夹包含不支持的条件。');
  return { version: 1, filters: JSON.parse(JSON.stringify(query)) as Prisma.InputJsonObject };
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
