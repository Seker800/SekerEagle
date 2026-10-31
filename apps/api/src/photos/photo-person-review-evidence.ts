import { Prisma } from '@prisma/client';
import { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';
import { normalizeEmbedding } from '@sekereagle/vector-core';

// Retrieval is deliberately broader than the evidence required to ask a question.
// These are conservative product cutoffs, not identity probabilities.
export const PERSON_REVIEW_RETRIEVAL_SIMILARITY = 0.4;
export const PERSON_REVIEW_SAMPLE_LIMIT = 3;
const CORROBORATING_SIMILARITY = 0.5;
const STRONG_SIMILARITY = 0.55;
const SINGLE_SAMPLE_SIMILARITY = 0.6;

type ReviewPair = { firstId: string; secondId: string; firstCount?: bigint; secondCount?: bigint };
export type ReviewFaceEvidence = {
  faceId: string;
  personId: string;
  assetId: string;
  modelVersion: string;
  embedding: number[];
};
export type QualifiedReviewPair<T> = T & {
  similarity: number;
  firstFaceId: string;
  secondFaceId: string;
};

/** Only independently supported, current face samples may become a human question. */
export function qualifyPersonReviewPairs<T extends ReviewPair>(
  pairs: readonly T[],
  faces: readonly ReviewFaceEvidence[],
): QualifiedReviewPair<T>[] {
  const byPerson = new Map<string, ReviewFaceEvidence[]>();
  for (const face of faces) {
    if (
      face.modelVersion !== PHOTO_FACE_MODEL_VERSION ||
      face.embedding.length !== 128 ||
      face.embedding.some((v) => !Number.isFinite(v) || Math.abs(v) > 1.001)
    )
      continue;
    try {
      const samples = byPerson.get(face.personId) ?? [];
      if (
        samples.length >= PERSON_REVIEW_SAMPLE_LIMIT ||
        samples.some((s) => s.assetId === face.assetId)
      )
        continue;
      samples.push({ ...face, embedding: normalizeEmbedding(face.embedding) });
      byPerson.set(face.personId, samples);
    } catch {
      /* A zero or malformed vector provides no identity evidence. */
    }
  }
  const qualified: QualifiedReviewPair<T>[] = [];
  for (const pair of pairs) {
    const a = byPerson.get(pair.firstId) ?? [],
      b = byPerson.get(pair.secondId) ?? [];
    if (!a.length || !b.length || a.some((x) => b.some((y) => x.assetId === y.assetId))) continue;
    const matrix = a.map((x) =>
      b.map((y) =>
        Math.min(
          1,
          x.embedding.reduce((sum, v, i) => sum + v * y.embedding[i]!, 0),
        ),
      ),
    );
    const aScores = matrix.map((row) => Math.max(...row));
    const bScores = b.map((_, i) => Math.max(...matrix.map((row) => row[i]!)));
    const best = Math.max(...aScores);
    if (a.length === 1 && b.length === 1) {
      if (best < SINGLE_SAMPLE_SIMILARITY) continue;
    } else if (
      best < STRONG_SIMILARITY ||
      aScores.filter((s) => s >= CORROBORATING_SIMILARITY).length < Math.min(2, a.length) ||
      bScores.filter((s) => s >= CORROBORATING_SIMILARITY).length < Math.min(2, b.length)
    )
      continue;
    const mean = (scores: number[]) => scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const similarity = Math.min(mean(aScores), mean(bScores));
    if (similarity < CORROBORATING_SIMILARITY) continue;
    const firstIndex = aScores.indexOf(best),
      secondIndex = matrix[firstIndex]!.indexOf(best);
    qualified.push({
      ...pair,
      similarity,
      firstFaceId: a[firstIndex]!.faceId,
      secondFaceId: b[secondIndex]!.faceId,
    });
  }
  qualified.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      Number(
        (b.firstCount ?? 0n) + (b.secondCount ?? 0n) - (a.firstCount ?? 0n) - (a.secondCount ?? 0n),
      ) ||
      a.firstId.localeCompare(b.firstId) ||
      a.secondId.localeCompare(b.secondId),
  );
  // Do not ask a rapid series of different questions about the same identity.
  const used = new Set<string>();
  return qualified
    .filter((pair) => {
      if (used.has(pair.firstId) || used.has(pair.secondId)) return false;
      used.add(pair.firstId);
      used.add(pair.secondId);
      return true;
    })
    .slice(0, 100);
}

/** Bounded exemplars, one face per actual photo. No biometric data leaves the API. */
export async function readPersonReviewEvidence(
  tx: Prisma.TransactionClient,
  ownerId: string,
  includePrivate: boolean,
  personIds: readonly string[],
): Promise<ReviewFaceEvidence[]> {
  const ids = [...new Set(personIds)];
  if (!ids.length) return [];
  return tx.$queryRaw<ReviewFaceEvidence[]>(Prisma.sql`
    WITH usable AS (
      SELECT f.id AS "faceId",f."personId",f."assetId",f."modelVersion",f.embedding,f.confidence,
        r.width * f.box[3] * r.height * f.box[4] AS pixels,
        row_number() OVER(PARTITION BY f."personId",f."assetId" ORDER BY f.confidence DESC,f.id) AS duplicate
      FROM "EaglePhotoFace" f
      JOIN "EaglePhotoPerson" p ON p.id=f."personId" AND p."ownerId"=f."ownerId" AND p."libraryMode"=f."libraryMode"
      JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode"
      JOIN LATERAL (
        SELECT r.width,r.height FROM "EagleAssetRendition" r
        WHERE r."assetId"=a.id AND r."ownerId"=a."ownerId" AND r."libraryMode"=a."libraryMode"
          AND r.revision=a."mediaRevision" AND r.status='READY' AND r.kind='PREVIEW'
          AND r.variant='default' AND r."mimeType" LIKE 'image/%'
        ORDER BY r.width * r.height DESC,r.id LIMIT 1
      ) r ON true
      WHERE f."ownerId"=${ownerId} AND f."libraryMode"='PHOTO' AND f."isCurrent"
        AND f."personId" IN (${Prisma.join(ids)}) AND f."assetRevision"=a."mediaRevision" AND a."deletedAt" IS NULL
        AND f."modelVersion"=p."modelVersion" AND f."modelVersion"=${PHOTO_FACE_MODEL_VERSION}
        AND (${includePrivate} OR (NOT a."isPrivate" AND NOT p."marksAssetsPrivate"))
        AND f.confidence BETWEEN 0.9 AND 1 AND cardinality(f.box)=4
        AND f.box[1]>=0 AND f.box[2]>=0 AND f.box[3]>0 AND f.box[4]>0
        AND f.box[1]+f.box[3]<=1.001 AND f.box[2]+f.box[4]<=1.001
        AND r.width * f.box[3]>=48 AND r.height * f.box[4]>=48
    ), ranked AS (
      SELECT *,row_number() OVER(PARTITION BY "personId" ORDER BY confidence DESC,pixels DESC,"faceId") AS position
      FROM usable WHERE duplicate=1
    ) SELECT "faceId","personId","assetId","modelVersion",embedding FROM ranked
      WHERE position<=${PERSON_REVIEW_SAMPLE_LIMIT} ORDER BY "personId",position
  `);
}
