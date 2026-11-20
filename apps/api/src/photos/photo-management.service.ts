import { databaseBatches, DATABASE_STATEMENTS } from '../eagle/eagle-database-batches';
import { runLibraryTransaction } from '../eagle/eagle-library-command';
import { readMemoryPhotoFacets } from './photo-memory-client';
import { readPeopleCountPage } from './photo-person-count-page';
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
import { defaultAssetSort, type EagleAssetSort } from '../eagle/eagle-asset-order';
import {
  lockOwnerPrivacyProjection,
  syncAssetPrivacy,
  queuePhotoFaceScan,
} from '@sekereagle/library-persistence';
import { facePreviewSelect, previewSelect, serializePreview } from './photo-preview';
import { suggestPhotoGroups } from './photo-grouping';
import {
  visiblePhotoAssets,
  visiblePhotoPeople,
  requireVisiblePerson,
  personPreviewSelect,
  serializePersonPreview,
} from './photo-person-scope';
import { mergeSelectedPeople } from './photo-person-merge';
import { normalizeEmbedding } from '@sekereagle/vector-core';

const visible = visiblePhotoAssets;

async function refreshPersonPrototype(
  tx: Prisma.TransactionClient,
  ownerId: string,
  personId: string,
) {
  const faces = await tx.eaglePhotoFace.findMany({
    where: { ownerId, libraryMode: 'PHOTO', personId, isCurrent: true },
    select: { embedding: true },
    orderBy: { confidence: 'desc' },
    take: 32,
  });
  const embeddings = faces
    .map((face) => face.embedding)
    .filter((embedding) => embedding.length === 128);
  if (!embeddings.length) return;
  const prototype = normalizeEmbedding(
    Array.from(
      { length: 128 },
      (_, index) => embeddings.reduce((sum, row) => sum + row[index]!, 0) / embeddings.length,
    ),
  );
  await tx.eaglePhotoPerson.update({ where: { id: personId }, data: { prototype } });
}

@Injectable()
export class PhotoManagementService {
  constructor(private readonly prisma: PrismaService) {}
  /** Unlocked authorization only; all mutable rules are rechecked during publication. */
  async admitCommand(
    ownerId: string,
    includePrivate: boolean,
    type: string,
    payload: Prisma.InputJsonObject,
  ) {
    const p = payload as Record<string, unknown>;
    const people =
      type === 'PHOTO_PEOPLE_REVIEW'
        ? [p.firstId, p.secondId]
        : type === 'PHOTO_PEOPLE_MERGE_SELECTED'
          ? (p.people as Array<{ id: string }>).map((person) => person.id)
          : type === 'PHOTO_PEOPLE_MERGE'
            ? [p.id, p.targetId]
            : type.startsWith('PHOTO_PERSON_')
              ? [p.id]
              : type === 'PHOTO_FACE_REASSIGN' && p.personId
                ? [p.personId]
                : [];
    const personIds = [...new Set(people as string[])];
    for (const { rows } of databaseBatches(personIds, DATABASE_STATEMENTS.operationAssetLookup))
      if (
        (await this.prisma.eaglePhotoPerson.count({
          where: { ...visiblePhotoPeople(ownerId, includePrivate), id: { in: rows } },
        })) !== rows.length
      )
        throw new NotFoundException('人物不存在。');
    if (
      type === 'PHOTO_FACE_REASSIGN' &&
      !(await this.prisma.eaglePhotoFace.findFirst({
        where: {
          id: p.id as string,
          ownerId,
          libraryMode: 'PHOTO',
          isCurrent: true,
          asset: visible(ownerId, includePrivate),
        },
        select: { id: true },
      }))
    )
      throw new NotFoundException('人脸不存在。');
    if (type === 'PHOTO_FACE_BATCH') {
      const faceIds = [...new Set((p.ids as string[] | undefined) ?? [])];
      for (const { rows } of databaseBatches(faceIds, DATABASE_STATEMENTS.operationAssetLookup))
        if (
          (await this.prisma.eaglePhotoFace.count({
            where: {
              ownerId,
              libraryMode: 'PHOTO',
              isCurrent: true,
              id: { in: rows },
              asset: visible(ownerId, includePrivate),
            },
          })) !== rows.length
        )
          throw new NotFoundException('人脸不存在。');
    }
    const groupIds =
      type === 'PHOTO_GROUP_MERGE'
        ? [p.id, p.targetId]
        : ['PHOTO_GROUP_UPDATE', 'PHOTO_GROUP_REMOVE_MEMBERS'].includes(type)
          ? [p.id]
          : [];
    if (
      groupIds.length &&
      (await this.prisma.eaglePhotoGroup.count({
        where: {
          id: { in: groupIds as string[] },
          ownerId,
          libraryMode: 'PHOTO',
          members: { some: {}, every: { asset: visible(ownerId, includePrivate) } },
        },
      })) !== new Set(groupIds).size
    )
      throw new NotFoundException('照片组不存在。');
    const assetIds = [...new Set((p.assetIds as string[] | undefined) ?? [])];
    for (const { rows } of databaseBatches(assetIds, DATABASE_STATEMENTS.operationAssetLookup)) {
      if (
        (await this.prisma.eagleAsset.count({
          where: { ...visible(ownerId, includePrivate), id: { in: rows } },
        })) !== rows.length
      )
        throw new NotFoundException('照片不存在。');
      if (
        type === 'PHOTO_GROUP_REMOVE_MEMBERS' &&
        (await this.prisma.eaglePhotoGroupMember.count({
          where: { groupId: p.id as string, ownerId, libraryMode: 'PHOTO', assetId: { in: rows } },
        })) !== rows.length
      )
        throw new NotFoundException('组内照片不存在。');
    }
    if (
      p.bestAssetId &&
      !(await this.prisma.eaglePhotoGroupMember.findFirst({
        where: {
          ownerId,
          libraryMode: 'PHOTO',
          groupId: p.id as string,
          assetId: p.bestAssetId as string,
          asset: visible(ownerId, includePrivate),
        },
        select: { assetId: true },
      }))
    )
      throw new NotFoundException('组内照片不存在。');
  }
  async timeline(ownerId: string, includePrivate: boolean, sort?: EagleAssetSort) {
    const column =
      sort === 'ADDED_AT' ? Prisma.sql`"libraryAddedAt"` : Prisma.sql`"chronologicalAt"`;
    const rows = await this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>(Prisma.sql`
      SELECT date_trunc('month', ${column}) AS month, count(*) AS count
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
            sort ?? defaultAssetSort('PHOTO'),
          ),
        };
      }),
    };
  }
  async facets(ownerId: string, includePrivate: boolean) {
    const resident = await readMemoryPhotoFacets(ownerId, includePrivate);
    if (resident) return resident;
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
    search?: string,
  ) {
    const category = view === 'NAMED' || view === 'UNNAMED' ? view : 'ALL';
    const query = search?.trim();
    const representation =
      view === 'cards' || view === 'options' || view === 'full' ? view : projection;
    // The explicit card projection has a ranked cursor; legacy full/options keep their protocol.
    if (category === 'UNNAMED' || (view === 'ALL' && representation === 'cards'))
      return this.prisma.$transaction(
        async (tx) => {
          const page = await readPeopleCountPage(
            tx,
            ownerId,
            includePrivate,
            after,
            category === 'UNNAMED' ? 'UNNAMED' : 'ALL',
          );
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
        ...(category === 'NAMED'
          ? query
            ? { name: { contains: query, mode: 'insensitive' as const } }
            : { name: { not: null } }
          : {}),
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
  async scanFaces(
    ownerId: string,
    includePrivate: boolean,
    beforePublish?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    // The scan only admits durable face jobs. Inference runs on the current media
    // fleet, so the background executor must not require a local model install.
    return queuePhotoFaceScan(this.prisma, ownerId, includePrivate, beforePublish);
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
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return runLibraryTransaction(db, async (tx) => {
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
  async renamePerson(
    ownerId: string,
    id: string,
    name: string,
    includePrivate: boolean,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return runLibraryTransaction(db, async (tx) => {
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
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (sourceId === targetId) throw new BadRequestException('请选择另一个人物。');
    return runLibraryTransaction(db, async (tx) => {
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
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return runLibraryTransaction(db, async (tx) => {
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
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return runLibraryTransaction(db, async (tx) => {
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
      if (face.personId && face.personId !== person.id) {
        const remaining = await tx.eaglePhotoFace.count({
          where: {
            ownerId,
            libraryMode: 'PHOTO',
            personId: face.personId,
            isCurrent: true,
          },
        });
        // Keep an empty identity for undo; it is hidden from every people projection
        // because those require a current face.
        if (remaining > 0) await refreshPersonPrototype(tx, ownerId, face.personId);
      }
      if (targetId) await refreshPersonPrototype(tx, ownerId, person.id);
      await syncAssetPrivacy(tx, ownerId, [face.assetId], 'PHOTO');
      return { id: person.id };
    });
  }
  async batchFaces(
    ownerId: string,
    ids: readonly string[],
    action: 'SPLIT' | 'REMOVE',
    includePrivate: boolean,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const unique = [...new Set(ids)];
    return runLibraryTransaction(db, async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      const faces = await tx.eaglePhotoFace.findMany({
        where: {
          id: { in: unique },
          ownerId,
          libraryMode: 'PHOTO',
          isCurrent: true,
          asset: visible(ownerId, includePrivate),
        },
        select: {
          id: true,
          personId: true,
          assetId: true,
          embedding: true,
          modelVersion: true,
        },
      });
      if (faces.length !== unique.length) throw new NotFoundException('人脸不存在。');
      const people = new Set(faces.flatMap((face) => (face.personId ? [face.personId] : [])));
      const assetIds = [...new Set(faces.map((face) => face.assetId))];
      if (action === 'REMOVE') {
        await tx.eaglePhotoFace.updateMany({
          where: { ownerId, libraryMode: 'PHOTO', id: { in: unique } },
          data: { isCurrent: false, personId: null, userAssigned: true },
        });
      } else {
        for (const face of faces) {
          const person = await tx.eaglePhotoPerson.create({
            data: {
              ownerId,
              libraryMode: 'PHOTO',
              prototype: face.embedding,
              modelVersion: face.modelVersion,
            },
          });
          await tx.eaglePhotoFace.update({
            where: { id: face.id },
            data: { personId: person.id, userAssigned: true },
          });
        }
      }
      if (people.size) {
        await tx.eaglePhotoPerson.updateMany({
          where: { ownerId, libraryMode: 'PHOTO', id: { in: [...people] } },
          data: { rowVersion: { increment: 1 } },
        });
        for (const personId of people) {
          const remaining = await tx.eaglePhotoFace.count({
            where: { ownerId, libraryMode: 'PHOTO', personId, isCurrent: true },
          });
          if (remaining === 0)
            await tx.eaglePhotoPerson.deleteMany({
              where: { ownerId, libraryMode: 'PHOTO', id: personId },
            });
          else await refreshPersonPrototype(tx, ownerId, personId);
        }
      }
      await syncAssetPrivacy(tx, ownerId, assetIds, 'PHOTO');
      return { changed: faces.length, privacyChanged: true };
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
  async scanGroups(
    ownerId: string,
    includePrivate: boolean,
    beforePublish?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const rows = await this.prisma.eaglePhotoMetadata.findMany({
      where: { ownerId, libraryMode: 'PHOTO', asset: visible(ownerId, includePrivate) },
      include: { asset: { select: { mimeType: true } } },
      orderBy: [{ capturedAt: 'desc' }, { assetId: 'asc' }],
    });
    const suggestions = suggestPhotoGroups(
      rows.map((row) => ({ ...row, id: row.assetId, mimeType: row.asset.mimeType })),
    );
    const revisions = new Map(rows.map((row) => [row.assetId, row.assetRevision]));
    return this.prisma.$transaction(
      async (tx) => {
        await beforePublish?.(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
        const manualMembers = await tx.eaglePhotoGroupMember.findMany({
          where: { ownerId, libraryMode: 'PHOTO', group: {} },
          select: { assetId: true },
        });
        const protectedAssets = new Set(manualMembers.map((row) => row.assetId));
        const candidates = suggestions
          .filter(
            (suggestion) => !suggestion.assetIds.some((assetId) => protectedAssets.has(assetId)),
          )
          .map((suggestion) => ({
            ...suggestion,
            sourceKey:
              'auto-v1:' +
              createHash('sha256')
                .update(
                  [...suggestion.assetIds]
                    .sort()
                    .map((id) => `${id}:${revisions.get(id) ?? 0}`)
                    .join(':'),
                )
                .digest('hex'),
          }));
        const existingKeys = new Set<string>();
        for (const { rows: keys } of databaseBatches(
          candidates.map((candidate) => candidate.sourceKey),
          { fixedParameters: 4, parametersPerRow: 1, targetRows: 500 },
        )) {
          const found = await tx.eaglePhotoGroup.findMany({
            where: { ownerId, libraryMode: 'PHOTO', sourceKey: { in: keys } },
            select: { sourceKey: true },
          });
          for (const row of found) existingKeys.add(row.sourceKey);
        }
        const createdGroups = candidates
          .filter((candidate) => !existingKeys.has(candidate.sourceKey))
          .map((candidate) => ({
            id: randomUUID(),
            ownerId,
            libraryMode: 'PHOTO' as const,
            sourceKey: candidate.sourceKey,
            kind: candidate.kind,
            bestAssetId: candidate.bestAssetId,
            assetIds: candidate.assetIds,
          }));
        for (const { rows: batch } of databaseBatches(createdGroups, {
          fixedParameters: 0,
          parametersPerRow: 6,
          targetRows: 500,
        }))
          await tx.eaglePhotoGroup.createMany({
            data: batch.map(({ assetIds: _assetIds, ...group }) => group),
          });
        const members = createdGroups.flatMap((group) =>
          group.assetIds.map((assetId) => ({
            ownerId,
            libraryMode: 'PHOTO' as const,
            groupId: group.id,
            assetId,
          })),
        );
        for (const { rows: batch } of databaseBatches(members, {
          fixedParameters: 0,
          parametersPerRow: 4,
          targetRows: 500,
        }))
          await tx.eaglePhotoGroupMember.createMany({ data: batch });
        return { created: createdGroups.length, scanned: rows.length };
      },
      { timeout: 120_000, maxWait: 5_000 },
    );
  }
  async createGroup(
    ownerId: string,
    assetIds: string[],
    includePrivate: boolean,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const unique = [...new Set(assetIds)];
    if (unique.length < 2) throw new BadRequestException('请至少选择 2 张照片。');
    return runLibraryTransaction(db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${ownerId}`}))`;
      let found = 0;
      for (const { rows } of databaseBatches(unique, DATABASE_STATEMENTS.operationAssetLookup))
        found += await tx.eagleAsset.count({
          where: { ...visible(ownerId, includePrivate), id: { in: rows } },
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
      for (const { rows } of databaseBatches(unique, {
        ...DATABASE_STATEMENTS.operationItems,
        parametersPerRow: 6,
      }))
        await tx.eaglePhotoGroupMember.createMany({
          data: rows.map((assetId) => ({
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
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return runLibraryTransaction(db, async (tx) => {
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
      const memberIds = new Set(group?.members.map((member) => member.assetId));
      if (!group || assetIds.some((assetId) => !memberIds.has(assetId)))
        throw new NotFoundException('组内照片不存在。');
      const unique = [...new Set(assetIds)];
      let removed = 0;
      for (const { rows } of databaseBatches(unique, DATABASE_STATEMENTS.operationAssetLookup))
        removed += (
          await tx.eaglePhotoGroupMember.deleteMany({
            where: { ownerId, libraryMode: 'PHOTO', groupId: id, assetId: { in: rows } },
          })
        ).count;
      const bestRemoved = group.bestAssetId !== null && assetIds.includes(group.bestAssetId);
      await tx.eaglePhotoGroup.update({
        where: { id },
        data: {
          kind: 'MANUAL',
          dismissed: group.members.length - removed < 2,
          ...(bestRemoved ? { bestAssetId: null, bestSelectedByUser: false } : {}),
        },
      });
      return { removed };
    });
  }
  async mergeGroups(
    ownerId: string,
    sourceId: string,
    targetId: string,
    includePrivate: boolean,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (sourceId === targetId) throw new BadRequestException('请选择另一个照片组。');
    return runLibraryTransaction(db, async (tx) => {
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
      for (const { rows } of databaseBatches(source.members, {
        ...DATABASE_STATEMENTS.operationItems,
        parametersPerRow: 6,
      }))
        await tx.eaglePhotoGroupMember.createMany({
          data: rows.map((member) => ({
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
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return runLibraryTransaction(db, async (tx) => {
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
