import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encodeEagleAssetCursor } from '../eagle/eagle-cursor';
import { suggestPhotoGroups } from './photo-grouping';

const MODEL_VERSION = 'yunet-2023mar-sface-2021dec-v1';
const visible = (ownerId: string, includePrivate: boolean): Prisma.EagleAssetWhereInput => ({
  ownerId,
  libraryMode: 'PHOTO',
  deletedAt: null,
  ...(!includePrivate ? { isPrivate: false } : {}),
});
const previewSelect = {
  id: true,
  displayName: true,
  libraryMode: true,
  originalName: true,
  mimeType: true,
  format: true,
  mediaRevision: true,
  libraryAddedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  lifecycleStatus: true,
  mediaErrorCode: true,
  rowVersion: true,
  rating: true,
  width: true,
  height: true,
  durationMs: true,
  byteSize: true,
  renditions: {
    where: { status: 'READY' as const },
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
  photoMetadata: true,
} satisfies Prisma.EagleAssetSelect;
const serializePreview = (
  asset: Prisma.EagleAssetGetPayload<{ select: typeof previewSelect }>,
) => ({
  ...asset,
  byteSize: Number(asset.byteSize),
  renditions: asset.renditions.map((row) => ({ ...row, byteSize: Number(row.byteSize) })),
  manualTags: [],
});

@Injectable()
export class PhotoManagementService {
  constructor(private readonly prisma: PrismaService) {}
  async timeline(ownerId: string, includePrivate: boolean) {
    const rows = await this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>(Prisma.sql`
      SELECT date_trunc('month', "chronologicalAt") AS month, count(*) AS count
      FROM "EagleAsset"
      WHERE "ownerId" = ${ownerId} AND "libraryMode" = 'PHOTO' AND "deletedAt" IS NULL
        ${includePrivate ? Prisma.empty : Prisma.sql`AND "isPrivate" = false`}
      GROUP BY 1 ORDER BY 1 DESC
    `);
    return {
      months: rows.map((row) => {
        const boundary = new Date(row.month);
        boundary.setUTCMonth(boundary.getUTCMonth() + 1);
        return {
          month: row.month.toISOString().slice(0, 7),
          count: Number(row.count),
          cursor: encodeEagleAssetCursor(
            { libraryAddedAt: boundary, id: '00000000-0000-0000-0000-000000000000' },
            { ownerId, libraryMode: 'PHOTO' },
          ),
        };
      }),
    };
  }
  async facets(ownerId: string, includePrivate: boolean) {
    const where = {
      ownerId,
      libraryMode: 'PHOTO' as const,
      asset: visible(ownerId, includePrivate),
    };
    const [cameras, lenses] = await Promise.all([
      this.prisma.eaglePhotoMetadata.groupBy({
        by: ['cameraModel'],
        where: { ...where, cameraModel: { not: null } },
        orderBy: { cameraModel: 'asc' },
        take: 500,
      }),
      this.prisma.eaglePhotoMetadata.groupBy({
        by: ['lensModel'],
        where: { ...where, lensModel: { not: null } },
        orderBy: { lensModel: 'asc' },
        take: 500,
      }),
    ]);
    return {
      cameras: cameras.flatMap((row) => (row.cameraModel ? [row.cameraModel] : [])),
      lenses: lenses.flatMap((row) => (row.lensModel ? [row.lensModel] : [])),
    };
  }
  async people(ownerId: string, includePrivate: boolean) {
    const rows = await this.prisma.eaglePhotoPerson.findMany({
      where: {
        ownerId,
        libraryMode: 'PHOTO',
        faces: { some: { isCurrent: true, asset: visible(ownerId, includePrivate) } },
      },
      select: {
        id: true,
        name: true,
        rowVersion: true,
        faces: {
          where: { isCurrent: true, asset: visible(ownerId, includePrivate) },
          select: {
            id: true,
            box: true,
            confidence: true,
            assetId: true,
            asset: { select: previewSelect },
          },
          take: 20,
          orderBy: { confidence: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return {
      runtimeConfigured: Boolean(process.env.PHOTO_FACE_PYTHON && process.env.PHOTO_FACE_MODEL_DIR),
      limits: { people: 200, facesPerPerson: 20 },
      people: rows.map((person) => ({
        ...person,
        faces: person.faces.map((face) => ({ ...face, asset: serializePreview(face.asset) })),
      })),
    };
  }
  async scanFaces(ownerId: string, includePrivate: boolean) {
    if (!process.env.PHOTO_FACE_PYTHON || !process.env.PHOTO_FACE_MODEL_DIR)
      throw new BadRequestException('本地人物模型尚未配置，请按照片功能文档安装模型运行环境。');
    const assets = await this.prisma.$queryRaw<
      Array<{ id: string; mediaRevision: number }>
    >(Prisma.sql`
      SELECT asset.id, asset."mediaRevision" FROM "EagleAsset" asset
      WHERE asset."ownerId" = ${ownerId} AND asset."libraryMode" = 'PHOTO'
        AND asset."deletedAt" IS NULL AND asset."lifecycleStatus" = 'READY'
        AND asset."mimeType" LIKE 'image/%' AND (${includePrivate} OR asset."isPrivate" = false)
        AND EXISTS (SELECT 1 FROM "EagleAssetRendition" r WHERE r."ownerId" = asset."ownerId" AND r."libraryMode" = asset."libraryMode" AND r."assetId" = asset.id AND r.revision = asset."mediaRevision" AND r.kind = 'PREVIEW' AND r.status = 'READY')
        AND NOT EXISTS (SELECT 1 FROM "EagleMediaJob" job WHERE job."ownerId" = asset."ownerId" AND job."libraryMode" = asset."libraryMode" AND job."assetId" = asset.id AND job."assetRevision" = asset."mediaRevision" AND job.kind = 'ANALYZE_PHOTO_FACES' AND job."processorVersion" = ${MODEL_VERSION} AND (job.status IN ('COMPLETED','PROCESSING','FAILED') OR (job.status = 'PENDING' AND job.lane = 'INTERACTIVE')))
      ORDER BY asset.id LIMIT 500
    `);
    const result = await this.prisma.eagleAssetProcessingJob.createMany({
      data: assets.map((asset) => ({
        ownerId,
        libraryMode: 'PHOTO',
        assetId: asset.id,
        assetRevision: asset.mediaRevision,
        kind: 'ANALYZE_PHOTO_FACES',
        processorVersion: MODEL_VERSION,
        lane: 'INTERACTIVE',
      })),
      skipDuplicates: true,
    });
    const promoted = assets.length
      ? await this.prisma.eagleAssetProcessingJob.updateMany({
          where: {
            ownerId,
            libraryMode: 'PHOTO',
            kind: 'ANALYZE_PHOTO_FACES',
            processorVersion: MODEL_VERSION,
            status: 'PENDING',
            lane: 'BACKGROUND',
            OR: assets.map((asset) => ({ assetId: asset.id, assetRevision: asset.mediaRevision })),
          },
          data: { lane: 'INTERACTIVE', availableAt: new Date() },
        })
      : { count: 0 };
    return { queued: result.count + promoted.count, scanned: assets.length, limit: 500 };
  }
  private async requirePerson(
    tx: Prisma.TransactionClient,
    ownerId: string,
    id: string,
    includePrivate: boolean,
  ) {
    const person = await tx.eaglePhotoPerson.findFirst({
      where: {
        id,
        ownerId,
        libraryMode: 'PHOTO',
        faces: { some: { isCurrent: true, asset: visible(ownerId, includePrivate) } },
      },
    });
    if (!person) throw new NotFoundException('人物不存在。');
    return person;
  }
  async renamePerson(ownerId: string, id: string, name: string, includePrivate: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      await this.requirePerson(tx, ownerId, id, includePrivate);
      return tx.eaglePhotoPerson.update({
        where: { id },
        data: { name: name.trim() || null, rowVersion: { increment: 1 } },
        select: { id: true, name: true, rowVersion: true },
      });
    });
  }
  async mergePeople(ownerId: string, sourceId: string, targetId: string, includePrivate: boolean) {
    if (sourceId === targetId) throw new BadRequestException('请选择另一个人物。');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      await this.requirePerson(tx, ownerId, sourceId, includePrivate);
      await this.requirePerson(tx, ownerId, targetId, includePrivate);
      await tx.eaglePhotoFace.updateMany({
        where: { ownerId, libraryMode: 'PHOTO', personId: sourceId },
        data: { personId: targetId, userAssigned: true },
      });
      await tx.eaglePhotoPerson.delete({ where: { id: sourceId } });
      return { id: targetId };
    });
  }
  async reassignFace(
    ownerId: string,
    faceId: string,
    targetId: string | null,
    includePrivate: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      const face = await tx.eaglePhotoFace.findFirst({
        where: {
          id: faceId,
          ownerId,
          libraryMode: 'PHOTO',
          isCurrent: true,
          asset: visible(ownerId, includePrivate),
        },
      });
      if (!face) throw new NotFoundException('人脸不存在。');
      const person = targetId
        ? await this.requirePerson(tx, ownerId, targetId, includePrivate)
        : await tx.eaglePhotoPerson.create({
            data: {
              ownerId,
              libraryMode: 'PHOTO',
              prototype: face.embedding,
              modelVersion: face.modelVersion,
            },
          });
      await tx.eaglePhotoFace.update({
        where: { id: faceId },
        data: { personId: person.id, userAssigned: true },
      });
      return { id: person.id };
    });
  }
  async groups(ownerId: string, includePrivate: boolean) {
    const groups = await this.prisma.eaglePhotoGroup.findMany({
      where: {
        ownerId,
        libraryMode: 'PHOTO',
        dismissed: false,
        members: { some: {}, every: { asset: visible(ownerId, includePrivate) } },
      },
      include: { members: { include: { asset: { select: previewSelect } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return groups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ asset: serializePreview(member.asset) })),
    }));
  }
  async scanGroups(ownerId: string, includePrivate: boolean) {
    const rows = await this.prisma.eaglePhotoMetadata.findMany({
      where: { ownerId, libraryMode: 'PHOTO', asset: visible(ownerId, includePrivate) },
      orderBy: [{ capturedAt: 'desc' }, { assetId: 'asc' }],
      take: 2000,
    });
    const suggestions = suggestPhotoGroups(rows.map((row) => ({ ...row, id: row.assetId })));
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
      const manualMembers = await tx.eaglePhotoGroupMember.findMany({
        where: { ownerId, libraryMode: 'PHOTO', group: {} },
        select: { assetId: true },
      });
      const protectedAssets = new Set(manualMembers.map((row) => row.assetId));
      let created = 0;
      for (const suggestion of suggestions) {
        if (suggestion.assetIds.some((assetId) => protectedAssets.has(assetId))) continue;
        const sourceKey =
          'auto-v1:' +
          createHash('sha256')
            .update(
              [...suggestion.assetIds]
                .sort()
                .map((id) => `${id}:${rows.find((row) => row.assetId === id)?.assetRevision ?? 0}`)
                .join(':'),
            )
            .digest('hex');
        const exists = await tx.eaglePhotoGroup.findUnique({
          where: { ownerId_libraryMode_sourceKey: { ownerId, libraryMode: 'PHOTO', sourceKey } },
        });
        if (exists) continue; // Human choices, including dismissed suggestions, survive rescans.
        const group = await tx.eaglePhotoGroup.create({
          data: {
            ownerId,
            libraryMode: 'PHOTO',
            sourceKey,
            kind: suggestion.kind,
            bestAssetId: suggestion.bestAssetId,
          },
        });
        await tx.eaglePhotoGroupMember.createMany({
          data: suggestion.assetIds.map((assetId) => ({
            ownerId,
            libraryMode: 'PHOTO',
            groupId: group.id,
            assetId,
          })),
        });
        created++;
      }
      return { created, scanned: rows.length, limit: 2000 };
    });
  }
  async createGroup(ownerId: string, assetIds: string[], includePrivate: boolean) {
    const unique = [...new Set(assetIds)];
    if (unique.length < 2 || unique.length > 500)
      throw new BadRequestException('请选择 2 到 500 张照片。');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
      const found = await tx.eagleAsset.count({
        where: { ...visible(ownerId, includePrivate), id: { in: unique } },
      });
      if (found !== unique.length) throw new NotFoundException('照片不存在。');
      const group = await tx.eaglePhotoGroup.create({
        data: {
          ownerId,
          libraryMode: 'PHOTO',
          kind: 'MANUAL',
          sourceKey: `manual:${randomUUID()}`,
        },
      });
      await tx.eaglePhotoGroupMember.createMany({
        data: unique.map((assetId) => ({
          ownerId,
          libraryMode: 'PHOTO',
          groupId: group.id,
          assetId,
        })),
      });
      return { id: group.id };
    });
  }
  async removeGroupMembers(
    ownerId: string,
    id: string,
    assetIds: string[],
    includePrivate: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
      const group = await tx.eaglePhotoGroup.findFirst({
        where: {
          id,
          ownerId,
          libraryMode: 'PHOTO',
          dismissed: false,
          members: { some: {}, every: { asset: visible(ownerId, includePrivate) } },
        },
        include: { members: true },
      });
      if (
        !group ||
        assetIds.some((assetId) => !group.members.some((member) => member.assetId === assetId))
      )
        throw new NotFoundException('组内照片不存在。');
      const removed = await tx.eaglePhotoGroupMember.deleteMany({
        where: { ownerId, libraryMode: 'PHOTO', groupId: id, assetId: { in: assetIds } },
      });
      const bestRemoved = group.bestAssetId !== null && assetIds.includes(group.bestAssetId);
      await tx.eaglePhotoGroup.update({
        where: { id },
        data: {
          kind: 'MANUAL',
          dismissed: group.members.length - removed.count < 2,
          ...(bestRemoved ? { bestAssetId: null, bestSelectedByUser: false } : {}),
        },
      });
      return { removed: removed.count };
    });
  }
  async mergeGroups(ownerId: string, sourceId: string, targetId: string, includePrivate: boolean) {
    if (sourceId === targetId) throw new BadRequestException('请选择另一个照片组。');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
      const groups = await tx.eaglePhotoGroup.findMany({
        where: {
          id: { in: [sourceId, targetId] },
          ownerId,
          libraryMode: 'PHOTO',
          dismissed: false,
          members: { some: {}, every: { asset: visible(ownerId, includePrivate) } },
        },
        include: { members: true },
      });
      if (groups.length !== 2) throw new NotFoundException('照片组不存在。');
      const source = groups.find((group) => group.id === sourceId)!;
      await tx.eaglePhotoGroupMember.createMany({
        data: source.members.map((member) => ({
          ownerId,
          libraryMode: 'PHOTO',
          groupId: targetId,
          assetId: member.assetId,
        })),
        skipDuplicates: true,
      });
      await tx.eaglePhotoGroup.update({ where: { id: targetId }, data: { kind: 'MANUAL' } });
      await tx.eaglePhotoGroup.update({ where: { id: sourceId }, data: { dismissed: true } });
      return { id: targetId };
    });
  }
  async updateGroup(
    ownerId: string,
    id: string,
    input: { dismissed?: boolean; bestAssetId?: string },
    includePrivate: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
      const group = await tx.eaglePhotoGroup.findFirst({
        where: {
          id,
          ownerId,
          libraryMode: 'PHOTO',
          members: input.bestAssetId
            ? { some: { assetId: input.bestAssetId, asset: visible(ownerId, includePrivate) } }
            : { some: {}, every: { asset: visible(ownerId, includePrivate) } },
        },
        include: { members: true },
      });
      if (!group) throw new NotFoundException('照片组不存在。');
      if (
        input.bestAssetId &&
        !group.members.some((member) => member.assetId === input.bestAssetId)
      )
        throw new NotFoundException('组内照片不存在。');
      return tx.eaglePhotoGroup.update({
        where: { id },
        data: {
          ...(input.dismissed !== undefined ? { dismissed: input.dismissed } : {}),
          ...(input.bestAssetId
            ? { bestAssetId: input.bestAssetId, bestSelectedByUser: true }
            : {}),
        },
        select: { id: true, bestAssetId: true, dismissed: true },
      });
    });
  }
}
