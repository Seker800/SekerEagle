import { FacePublicationBatcher } from './face-publication-batcher';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from '@sekereagle/library-persistence';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { EagleAssetProcessingJob, PrismaClient } from '@prisma/client';
import { normalizeEmbedding } from '@sekereagle/vector-core';
import { FACE_MODEL_VERSION, type FaceDetection } from './face-inference';
export {
  cosineSimilarity,
  FACE_MODEL_VERSION,
  validateFaceResult,
  inferPhotoFaces,
  stopFaceInference,
  type FaceDetection,
} from './face-inference';
interface FacePublication {
  job: EagleAssetProcessingJob;
  detections: FaceDetection[];
}
/** A person's prototype follows confirmed-looking faces instead of freezing the first one. */
const PROTOTYPE_BLEND = 0.2;
export function blendFacePrototype(
  prototype: readonly number[],
  embedding: readonly number[],
): number[] {
  if (!prototype.length || prototype.length !== embedding.length)
    return normalizeEmbedding(embedding);
  return normalizeEmbedding(
    prototype.map(
      (value, index) => value * (1 - PROTOTYPE_BLEND) + embedding[index]! * PROTOTYPE_BLEND,
    ),
  );
}
/** pgvector nearest prototype inside the same transaction, excluding already assigned people. */
async function nearestPersonId(
  tx: Prisma.TransactionClient,
  ownerId: string,
  embedding: number[],
  assigned: ReadonlySet<string>,
): Promise<{ id: string; prototype: number[]; score: number } | undefined> {
  const vector = `[${embedding.join(',')}]`;
  const rows = await tx.$queryRaw<
    Array<{ id: string; prototype: number[]; score: number }>
  >(Prisma.sql`
    SELECT id, prototype, 1 - (prototype::vector <=> ${vector}::vector) AS score
    FROM "EaglePhotoPerson"
    WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO'::"LibraryMode"
      AND "modelVersion"=${FACE_MODEL_VERSION}
      AND cardinality(prototype)=128
      AND NOT (id = ANY(${[...assigned]}::text[]))
    ORDER BY prototype::vector <=> ${vector}::vector
    LIMIT 32
  `);
  return rows[0] && rows[0].score >= 0.45 ? rows[0] : undefined;
}
const publishers = new WeakMap<
  PrismaClient,
  Map<string, FacePublicationBatcher<FacePublication>>
>();
export async function persistPhotoFaces(
  prisma: PrismaClient,
  job: EagleAssetProcessingJob,
  detections: FaceDetection[],
) {
  if (job.libraryMode !== 'PHOTO') throw new Error('PHOTO_FACE_LIBRARY_MISMATCH');
  let owners = publishers.get(prisma);
  if (!owners) {
    owners = new Map();
    publishers.set(prisma, owners);
  }
  let publisher = owners.get(job.ownerId);
  if (!publisher) {
    publisher = new FacePublicationBatcher<FacePublication>(
      async (entries) => {
        await prisma.$transaction(async (tx) => {
          const prototypes = new Map<string, number[]>();
          for (const entry of entries)
            await persistPhotoFacesInTransaction(tx, entry.job, entry.detections, prototypes);
          // One statement per matched person per publication batch; the workspace
          // change trigger must not fire once for every detected face.
          for (const [id, prototype] of prototypes)
            await tx.eaglePhotoPerson.update({ where: { id }, data: { prototype } });
        });
      },
      (entry) => entry.job.ownerId,
      (entry) => entry.detections.length,
    );
    owners.set(job.ownerId, publisher);
  }
  try {
    await publisher.enqueue({ job, detections });
  } finally {
    if (publisher.idle && owners.get(job.ownerId) === publisher) owners.delete(job.ownerId);
  }
}
async function persistPhotoFacesInTransaction(
  tx: Prisma.TransactionClient,
  job: EagleAssetProcessingJob,
  detections: FaceDetection[],
  prototypes: Map<string, number[]>,
) {
  await lockOwnerPrivacyProjection(tx, job.ownerId, 'PHOTO');
  // Serialize automatic assignments against human merges/corrections for this owner.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-people:${job.ownerId}`}))`;
  const current = await tx.eagleAsset.findFirst({
    where: {
      id: job.assetId,
      ownerId: job.ownerId,
      libraryMode: 'PHOTO',
      mediaRevision: job.assetRevision,
      deletedAt: null,
    },
  });
  const claimed = await tx.eagleAssetProcessingJob.updateMany({
    where: { id: job.id, leaseVersion: job.leaseVersion, status: 'PROCESSING' },
    data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
  });
  if (claimed.count !== 1 || !current) return;
  await tx.eaglePhotoFace.updateMany({
    where: {
      ownerId: job.ownerId,
      libraryMode: 'PHOTO',
      assetId: job.assetId,
      OR: [
        { assetRevision: { not: job.assetRevision } },
        { modelVersion: { not: FACE_MODEL_VERSION }, userAssigned: false },
      ],
    },
    data: { isCurrent: false },
  });
  const corrected = detections.length
    ? await tx.eaglePhotoFace.findMany({
        where: {
          ownerId: job.ownerId,
          libraryMode: 'PHOTO',
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          isCurrent: true,
          userAssigned: true,
        },
      })
    : [];
  const assigned = new Set<string>(
    corrected.flatMap((face) => (face.personId ? [face.personId] : [])),
  );
  for (const [index, face] of detections.entries()) {
    // Preserve human identities even when an upgraded detector changes its face indices.
    if (corrected.some((row) => faceBoxOverlap(row.box, face.box) >= 0.5)) continue;
    const id = createHash('sha256')
      .update(`${job.assetId}:${job.assetRevision}:${FACE_MODEL_VERSION}:${index}`)
      .digest('hex');
    const existing = await tx.eaglePhotoFace.findUnique({ where: { id } });
    if (existing) {
      if (existing.personId) assigned.add(existing.personId);
      continue;
    }
    const nearest = await nearestPersonId(tx, job.ownerId, face.embedding, assigned);
    const person = nearest
      ? { id: nearest.id }
      : await tx.eaglePhotoPerson.create({
          data: {
            ownerId: job.ownerId,
            libraryMode: 'PHOTO',
            prototype: face.embedding,
            modelVersion: FACE_MODEL_VERSION,
          },
        });
    if (nearest) {
      const current = prototypes.get(nearest.id) ?? nearest.prototype;
      prototypes.set(nearest.id, blendFacePrototype(current, face.embedding));
    }
    assigned.add(person.id);
    await tx.eaglePhotoFace.create({
      data: {
        id,
        ownerId: job.ownerId,
        libraryMode: 'PHOTO',
        assetId: job.assetId,
        assetRevision: job.assetRevision,
        modelVersion: FACE_MODEL_VERSION,
        personId: person.id,
        ...face,
      },
    });
  }
  await syncAssetPrivacy(tx, job.ownerId, [job.assetId], 'PHOTO');
}

function faceBoxOverlap(a: number[], b: number[]) {
  const intersection =
    Math.max(0, Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - Math.max(a[0]!, b[0]!)) *
    Math.max(0, Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - Math.max(a[1]!, b[1]!));
  return intersection / Math.max(Number.EPSILON, a[2]! * a[3]! + b[2]! * b[3]! - intersection);
}
