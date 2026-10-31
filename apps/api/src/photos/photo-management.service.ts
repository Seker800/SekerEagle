import { readUnnamedPeoplePage } from './photo-person-count-page';
import { representativePhotoFace } from '@sekereagle/library-core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encodeEagleAssetCursor } from '../eagle/eagle-cursor';
import {
  lockOwnerPrivacyProjection,
  syncAssetPrivacy,
  queuePhotoFaceScan,
} from '@sekereagle/library-persistence';
import { facePreviewSelect, previewSelect, serializePreview } from './photo-preview';
import { suggestPhotoGroups } from './photo-grouping';
import {
  visiblePhotoAssets,
  requireVisiblePerson,
  personPreviewSelect,
  serializePersonPreview,
} from './photo-person-scope';
import { mergeSelectedPeople } from './photo-person-merge';

const visible = visiblePhotoAssets;

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
      }),
      this.prisma.eaglePhotoMetadata.groupBy({
        by: ['lensModel'],
        where: { ...where, lensModel: { not: null } },
        orderBy: { lensModel: 'asc' },
      }),
    ]);
    return {
      cameras: cameras.flatMap((row) => (row.cameraModel ? [row.cameraModel] : [])),
      lenses: lenses.flatMap((row) => (row.lensModel ? [row.lensModel] : [])),
    };
  }
  async people(
    ownerId: string,
    includePrivate: boolean,
    after?: string,
    view: 'ALL' | 'NAMED' | 'UNNAMED' | 'full' | 'cards' | 'options' = 'ALL',
    projection: 'full' | 'cards' | 'options' = 'full',
  ) {
    const category = view === 'NAMED' || view === 'UNNAMED' ? view : 'ALL';
    const representation =
      view === 'cards' || view === 'options' || view === 'full' ? view : projection;
    if (category === 'UNNAMED')
      return this.prisma.$transaction(
        async (tx) => {
          const page = await readUnnamedPeoplePage(tx, ownerId, includePrivate, after);
          const ids = page.rows.map((row) => row.id);
          if (representation === 'options') {
            const rows = await tx.eaglePhotoPerson.findMany({
              where: { ownerId, libraryMode: 'PHOTO', id: { in: ids } },
              select: { id: true, name: true, rowVersion: true, marksAssetsPrivate: true },
            });
            const names = new Map(rows.map((row) => [row.id, row]));
            return {
              runtimeConfigured: Boolean(
                process.env.PHOTO_FACE_PYTHON && process.env.PHOTO_FACE_MODEL_DIR,
              ),
              limits: { people: 24, facesPerPerson: 0 },
              nextCursor: page.nextCursor,
              people: page.rows.flatMap((row) => {
                const person = names.get(row.id);
                return person ? [{ ...person, photoCount: Number(row.photos) }] : [];
              }),
            };
          }

          const rows = ids.length
            ? await tx.eaglePhotoPerson.findMany({
                where: { ownerId, libraryMode: 'PHOTO', id: { in: ids } },
                select: personPreviewSelect(
                  ownerId,
                  includePrivate,
                  representation === 'cards' ? 1 : 20,
                  representation === 'cards'
                    ? page.rows.flatMap((row) => (row.faceId ? [row.faceId] : []))
                    : undefined,
                ),
              })
            : [];
          const byId = new Map(rows.map((row) => [row.id, row]));
          return {
            runtimeConfigured: Boolean(
              process.env.PHOTO_FACE_PYTHON && process.env.PHOTO_FACE_MODEL_DIR,
            ),
            limits: { people: 24, facesPerPerson: representation === 'cards' ? 1 : 20 },
            nextCursor: page.nextCursor,
            people: page.rows.flatMap((row) => {
              const person = byId.get(row.id);
              return person
                ? [{ ...serializePersonPreview(person), photoCount: Number(row.photos) }]
                : [];
            }),
          };
        },
        { isolationLevel: 'RepeatableRead', timeout: 12000 },
      );
    const pageSize = category === 'ALL' ? 200 : 24;
    const cursorScope = category === 'ALL' ? ownerId : `${ownerId}:${category}`;
    const cursor = after ? decodePeopleCursor(after, cursorScope, includePrivate) : null;
    const pageQuery = {
      where: {
        ownerId,
        libraryMode: 'PHOTO' as const,
        ...(category === 'NAMED' ? { name: { not: null } } : {}),
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
        ...(!includePrivate ? { marksAssetsPrivate: false } : {}),
        OR: [
          { faces: { some: { isCurrent: true, asset: visible(ownerId, includePrivate) } } },
          ...(includePrivate ? [{ marksAssetsPrivate: true }] : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      take: pageSize + 1,
    };
    const page = (rows: Array<{ id: string; createdAt: Date }>) => ({
      runtimeConfigured: Boolean(process.env.PHOTO_FACE_PYTHON && process.env.PHOTO_FACE_MODEL_DIR),
      limits: {
        people: pageSize,
        facesPerPerson: representation === 'options' ? 0 : representation === 'cards' ? 1 : 20,
      },
      nextCursor:
        rows.length > pageSize
          ? encodePeopleCursor(rows[pageSize - 1]!, cursorScope, includePrivate)
          : null,
    });
    if (representation === 'options') {
      const rows = await this.prisma.eaglePhotoPerson.findMany({
        ...pageQuery,
        select: {
          id: true,
          name: true,
          createdAt: true,
          rowVersion: true,
          marksAssetsPrivate: true,
        },
      });
      return {
        ...page(rows),
        people: rows.slice(0, pageSize).map(({ id, name, rowVersion, marksAssetsPrivate }) => ({
          id,
          name,
          rowVersion,
          marksAssetsPrivate,
        })),
      };
    }
    const rows = await this.prisma.eaglePhotoPerson.findMany({
      ...pageQuery,
      select: {
        id: true,
        name: true,
        createdAt: true,
        rowVersion: true,
        marksAssetsPrivate: true,
        faces: {
          where: {
            ownerId,
            libraryMode: 'PHOTO' as const,
            isCurrent: true,
            asset: visible(ownerId, includePrivate),
          },
          select: {
            id: true,
            box: true,
            confidence: true,
            assetId: true,
            asset: { select: representation === 'cards' ? facePreviewSelect : previewSelect },
          },
          take: 20,
          orderBy: [{ confidence: 'desc' }, { id: 'asc' }],
        },
      },
    });
    return {
      ...page(rows),
      people: rows.slice(0, pageSize).map((person) => {
        const representative =
          representation === 'cards' ? representativePhotoFace(person.faces) : undefined;
        const faces =
          representation === 'cards' ? (representative ? [representative] : []) : person.faces;
        return {
          ...person,
          faces: faces.map((face) => ({ ...face, asset: serializePreview(face.asset) })),
        };
      }),
    };
  }
  async personFaces(ownerId: string, personId: string, includePrivate: boolean, after?: string) {
    await this.requirePerson(this.prisma, ownerId, personId, includePrivate);
    const cursor = after ? decodePeopleCursor(after, ownerId, includePrivate, personId) : null;
    const rows = await this.prisma.eaglePhotoFace.findMany({
      where: {
        ownerId,
        libraryMode: 'PHOTO',
        personId,
        isCurrent: true,
        asset: visible(ownerId, includePrivate),
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        createdAt: true,
        box: true,
        confidence: true,
        assetId: true,
        asset: { select: facePreviewSelect },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 21,
    });
    return {
      nextCursor:
        rows.length > 20 ? encodePeopleCursor(rows[19]!, ownerId, includePrivate, personId) : null,
      faces: rows.slice(0, 20).map(({ createdAt: _createdAt, ...face }) => ({
        ...face,
        asset: serializePreview(face.asset),
      })),
    };
  }
  async scanFaces(ownerId: string, includePrivate: boolean) {
    if (!process.env.PHOTO_FACE_PYTHON || !process.env.PHOTO_FACE_MODEL_DIR)
      throw new BadRequestException('本地人物模型尚未配置，请按照片功能文档安装模型运行环境。');
    return queuePhotoFaceScan(this.prisma, ownerId, includePrivate);
  }
  private async requirePerson(
    tx: Pick<Prisma.TransactionClient, 'eaglePhotoPerson'>,
    ownerId: string,
    id: string,
    includePrivate: boolean,
  ) {
    return requireVisiblePerson(tx, ownerId, id, includePrivate);
  }

  async setPersonPrivacy(
    ownerId: string,
    id: string,
    marksAssetsPrivate: boolean,
    rowVersion: number,
    includePrivate: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      const person = await this.requirePerson(tx, ownerId, id, includePrivate);
      if (person.rowVersion !== rowVersion)
        throw new ConflictException('人物已变化，请刷新后重试。');
      const updated = await tx.eaglePhotoPerson.update({
        where: { id },
        data: { marksAssetsPrivate, rowVersion: { increment: 1 } },
        select: { id: true, marksAssetsPrivate: true, rowVersion: true },
      });
      const changed = await syncAssetPrivacy(tx, ownerId, undefined, 'PHOTO');
      return { ...updated, changed };
    });
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
  async mergePeople(
    ownerId: string,
    sourceId: string,
    targetId: string,
    includePrivate: boolean,
    versions?: { source: number; target: number },
  ) {
    if (sourceId === targetId) throw new BadRequestException('请选择另一个人物。');
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      return mergeSelectedPeople(tx, ownerId, includePrivate, targetId, [
        { id: sourceId, rowVersion: versions?.source },
        { id: targetId, rowVersion: versions?.target },
      ]);
    });
  }
  async mergeSelection(
    ownerId: string,
    includePrivate: boolean,
    targetId: string,
    people: readonly { id: string; rowVersion: number }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      return mergeSelectedPeople(tx, ownerId, includePrivate, targetId, people);
    });
  }
  async reassignFace(
    ownerId: string,
    faceId: string,
    targetId: string | null,
    includePrivate: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
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
      await tx.eaglePhotoPerson.updateMany({
        where: {
          ownerId,
          libraryMode: 'PHOTO',
          id: {
            in: [...new Set([face.personId, person.id].filter((id): id is string => Boolean(id)))],
          },
        },
        data: { rowVersion: { increment: 1 } },
      });
      await syncAssetPrivacy(tx, ownerId, [face.assetId], 'PHOTO');
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

function encodePeopleCursor(
  person: { id: string; createdAt: Date },
  ownerId: string,
  includePrivate: boolean,
  personId?: string,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      personId,
      ownerId,
      includePrivate,
      id: person.id,
      createdAt: person.createdAt.toISOString(),
    }),
  ).toString('base64url');
}
function decodePeopleCursor(
  value: string,
  ownerId: string,
  includePrivate: boolean,
  personId?: string,
): { id: string; createdAt: Date } {
  try {
    if (value.length > 1024) throw new Error('Cursor too long');
    const row = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const createdAt = new Date(String(row.createdAt));
    if (
      row.v !== 1 ||
      row.personId !== personId ||
      row.ownerId !== ownerId ||
      row.includePrivate !== includePrivate ||
      typeof row.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) ||
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== row.createdAt
    )
      throw new Error('Cursor invalid');
    return { id: row.id, createdAt };
  } catch {
    throw new BadRequestException('人物列表游标无效，请刷新列表。');
  }
}
