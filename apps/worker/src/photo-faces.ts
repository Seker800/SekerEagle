import { FacePublicationBatcher } from './face-publication-batcher';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from '@sekereagle/library-persistence';
import { createHash } from 'node:crypto';
import type { EagleAssetProcessingJob, PrismaClient, Prisma } from '@prisma/client';
import { cosineSimilarity, FACE_MODEL_VERSION, type FaceDetection } from './face-inference';
export {
  cosineSimilarity,
  FACE_MODEL_VERSION,
  validateFaceResult,
  inferPhotoFaces,
  type FaceDetection,
} from './face-inference';
interface FacePublication {
  job: EagleAssetProcessingJob;
  detections: FaceDetection[];
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
          for (const entry of entries)
            await persistPhotoFacesInTransaction(tx, entry.job, entry.detections);
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
  const people = await tx.eaglePhotoPerson.findMany({
    where: { ownerId: job.ownerId, libraryMode: 'PHOTO', modelVersion: FACE_MODEL_VERSION },
    take: 10000,
  });
  const corrected = await tx.eaglePhotoFace.findMany({
    where: {
      ownerId: job.ownerId,
      libraryMode: 'PHOTO',
      assetId: job.assetId,
      assetRevision: job.assetRevision,
      isCurrent: true,
      userAssigned: true,
    },
  });
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
    const nearest = people
      .filter((person) => !assigned.has(person.id))
      .map((person) => ({ person, score: cosineSimilarity(person.prototype, face.embedding) }))
      .sort((a, b) => b.score - a.score)[0];
    const person =
      nearest && nearest.score >= 0.45
        ? nearest.person
        : await tx.eaglePhotoPerson.create({
            data: {
              ownerId: job.ownerId,
              libraryMode: 'PHOTO',
              prototype: face.embedding,
              modelVersion: FACE_MODEL_VERSION,
            },
          });
    if (!people.some((row) => row.id === person.id)) people.push(person);
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
