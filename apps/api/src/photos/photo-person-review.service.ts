import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { lockOwnerPrivacyProjection } from '@sekereagle/library-persistence';
import { PhotoManagementService } from './photo-management.service';
import {
  personPreviewSelect,
  serializePersonPreview,
  visiblePhotoPeople,
  requireVisiblePerson,
} from './photo-person-scope';
import { encodeReviewCursor, personReviewCandidatesSql, reviewCursor } from './photo-person-review';
@Injectable()
export class PhotoPersonReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotoManagementService,
  ) {}
  async summary(ownerId: string, includePrivate: boolean) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [counts] = await tx.$queryRaw<Array<{ named: bigint; unnamed: bigint }>>`
        WITH visible AS MATERIALIZED (
          SELECT DISTINCT f."personId" AS id
          FROM "EaglePhotoFace" f JOIN "EagleAsset" a
            ON a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode" AND a.id=f."assetId"
          WHERE f."ownerId"=${ownerId} AND f."libraryMode"='PHOTO' AND f."isCurrent"
            AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
        )
        SELECT count(*) FILTER (WHERE p.name IS NOT NULL) AS named,
               count(*) FILTER (WHERE p.name IS NULL) AS unnamed
        FROM "EaglePhotoPerson" p LEFT JOIN visible v ON v.id=p.id
        WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO'
          AND (${includePrivate} OR NOT p."marksAssetsPrivate")
          AND (v.id IS NOT NULL OR (${includePrivate} AND p."marksAssetsPrivate"))
      `;
        return { named: Number(counts?.named ?? 0), unnamed: Number(counts?.unnamed ?? 0) };
      },
      { timeout: 12000 },
    );
  }

  async suggestions(ownerId: string, includePrivate: boolean, after?: string) {
    const cursor = reviewCursor(after, ownerId, includePrivate);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const rows = await tx.$queryRaw<
          Array<{
            anchorId: string;
            candidateId: string | null;
            score: number | null;
            anchorFaceIds: string[];
            candidateFaceIds: string[];
            lastAnchor: string;
            hasMore: boolean;
          }>
        >(personReviewCandidatesSql(ownerId, includePrivate, cursor));
        const ids = [
          ...new Set(rows.flatMap((r) => (r.candidateId ? [r.anchorId, r.candidateId] : []))),
        ];
        const people = ids.length
          ? await tx.eaglePhotoPerson.findMany({
              where: { ...visiblePhotoPeople(ownerId, includePrivate), id: { in: ids } },
              select: personPreviewSelect(
                ownerId,
                includePrivate,
                3,
                rows.flatMap((r) => [...r.anchorFaceIds, ...r.candidateFaceIds]),
              ),
            })
          : [];
        const map = new Map(people.map((p) => [p.id, serializePersonPreview(p)]));
        const seen = new Set<string>();
        const items = rows.flatMap((r) => {
          if (!r.candidateId || r.score === null || !Number.isFinite(r.score)) return [];
          const key = [r.anchorId, r.candidateId].sort().join(':');
          if (seen.has(key)) return [];
          seen.add(key);
          const first = map.get(r.anchorId),
            second = map.get(r.candidateId);
          return first && second ? [{ key, first, second, similarity: r.score }] : [];
        });
        return {
          items,
          nextCursor: rows[0]?.hasMore
            ? encodeReviewCursor(rows[0].lastAnchor, ownerId, includePrivate)
            : null,
        };
      },
      { timeout: 12000 },
    );
  }
  async decide(
    ownerId: string,
    includePrivate: boolean,
    input: {
      firstId: string;
      secondId: string;
      firstVersion: number;
      secondVersion: number;
      decision: 'SAME' | 'DIFFERENT';
    },
  ) {
    if (input.firstId === input.secondId) throw new ConflictException('请选择两个人物。');
    if (input.decision === 'SAME')
      return this.photos.mergePeople(ownerId, input.firstId, input.secondId, includePrivate, {
        source: input.firstVersion,
        target: input.secondVersion,
      });
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${ownerId}`}))`;
      const first = await requireVisiblePerson(tx, ownerId, input.firstId, includePrivate),
        second = await requireVisiblePerson(tx, ownerId, input.secondId, includePrivate);
      const pair = [input.firstId, input.secondId].sort();
      const firstId = pair[0]!,
        secondId = pair[1]!;
      const existing = await tx.eaglePhotoPersonSeparation.findUnique({
        where: {
          ownerId_libraryMode_firstId_secondId: {
            ownerId,
            libraryMode: 'PHOTO',
            firstId,
            secondId,
          },
        },
      });
      if (existing) return { saved: true };
      if (first.rowVersion !== input.firstVersion || second.rowVersion !== input.secondVersion)
        throw new ConflictException('人物已变化，请刷新后重试。');
      await tx.eaglePhotoPersonSeparation.createMany({
        data: [{ ownerId, libraryMode: 'PHOTO', firstId, secondId }],
        skipDuplicates: true,
      });
      await tx.eaglePhotoPerson.updateMany({
        where: { ownerId, libraryMode: 'PHOTO', id: { in: [firstId, secondId] } },
        data: { rowVersion: { increment: 1 } },
      });
      return { saved: true };
    });
  }
}
