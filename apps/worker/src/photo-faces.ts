import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { EagleAssetProcessingJob, PrismaClient } from '@prisma/client';

export const FACE_MODEL_VERSION = 'yunet-2023mar-sface-2021dec-v1';
interface FaceDetection {
  box: number[];
  confidence: number;
  embedding: number[];
}
export function cosineSimilarity(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length || !a.length) return -1;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! ** 2;
    bb += b[i]! ** 2;
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : -1;
}
export function validateFaceResult(value: unknown): FaceDetection[] {
  if (!value || typeof value !== 'object') throw new Error('FACE_RESULT_INVALID');
  const result = value as { version?: unknown; faces?: unknown };
  if (
    result.version !== FACE_MODEL_VERSION ||
    !Array.isArray(result.faces) ||
    result.faces.length > 128
  )
    throw new Error('FACE_RESULT_INVALID');
  return result.faces.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('FACE_RESULT_INVALID');
    const face = entry as FaceDetection;
    if (
      !Array.isArray(face.box) ||
      face.box.length !== 4 ||
      !face.box.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ||
      !Array.isArray(face.embedding) ||
      face.embedding.length !== 128 ||
      !face.embedding.every((x) => Number.isFinite(x) && Math.abs(x) <= 1.001) ||
      !Number.isFinite(face.confidence) ||
      face.confidence < 0 ||
      face.confidence > 1
    )
      throw new Error('FACE_RESULT_INVALID');
    if (Math.abs(cosineSimilarity(face.embedding, face.embedding) - 1) > 0.01)
      throw new Error('FACE_RESULT_INVALID');
    return face;
  });
}
export async function inferPhotoFaces(bytes: Buffer): Promise<FaceDetection[]> {
  if (!process.env.PHOTO_FACE_PYTHON || !process.env.PHOTO_FACE_MODEL_DIR)
    throw new Error('PHOTO_FACE_RUNTIME_NOT_CONFIGURED');
  if (bytes.length > 20 * 1024 * 1024) throw new Error('PHOTO_FACE_INPUT_TOO_LARGE');
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-faces-'));
  try {
    const image = join(directory, 'preview.jpg');
    await writeFile(image, bytes, { flag: 'wx' });
    const { stdout } = await promisify(execFile)(
      process.env.PHOTO_FACE_PYTHON,
      [
        resolve(process.env.PHOTO_FACE_SCRIPT ?? 'services/photo-face/infer.py'),
        resolve(process.env.PHOTO_FACE_MODEL_DIR),
        image,
      ],
      {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          OPENCV_IO_MAX_IMAGE_PIXELS: '4000000',
          OMP_NUM_THREADS: '1',
        },
      },
    );
    return validateFaceResult(JSON.parse(stdout) as unknown);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function persistPhotoFaces(
  prisma: PrismaClient,
  job: EagleAssetProcessingJob,
  detections: FaceDetection[],
) {
  if (job.libraryMode !== 'PHOTO') throw new Error('PHOTO_FACE_LIBRARY_MISMATCH');
  await prisma.$transaction(async (tx) => {
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
          { modelVersion: { not: FACE_MODEL_VERSION } },
        ],
      },
      data: { isCurrent: false },
    });
    const people = await tx.eaglePhotoPerson.findMany({
      where: { ownerId: job.ownerId, libraryMode: 'PHOTO', modelVersion: FACE_MODEL_VERSION },
      take: 10000,
    });
    const assigned = new Set<string>();
    for (const [index, face] of detections.entries()) {
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
  });
}
