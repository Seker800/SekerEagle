import { PrismaClient } from '@prisma/client';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertSafeRuntimeTarget } from '@sekereagle/config';
import { CAMERA_MAX_IMAGE_BYTES } from '@sekereagle/library-core';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readPhotoExif } from './photo-analysis';
import { persistPhotoAnalysis } from './photo-analysis-persistence';

import {
  validatePhotoMaintenanceManifest as validatePhotoMetadataRefreshManifest,
  assertPhotoMaintenanceCandidates as assertPhotoMetadataRefreshCandidates,
  type RefreshItem,
} from './photo-maintenance-scope';
export {
  validatePhotoMaintenanceManifest as validatePhotoMetadataRefreshManifest,
  assertPhotoMaintenanceCandidates as assertPhotoMetadataRefreshCandidates,
} from './photo-maintenance-scope';

/** Explicit, bounded maintenance. Originals, pixels, ownership and edited copies stay unchanged. */
async function refreshPhotoMetadata(manifest: RefreshItem[], apply: boolean) {
  assertSafeRuntimeTarget({
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3Endpoint: process.env.S3_ENDPOINT ?? '',
    s3Bucket: process.env.S3_BUCKET ?? '',
  });
  const prisma = new PrismaClient();
  const storage = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
  try {
    const assets = await prisma.eagleAsset.findMany({
      where: { id: { in: manifest.map((item) => item.assetId) }, libraryMode: 'PHOTO' },
      include: { photoMetadata: true },
    });
    assertPhotoMetadataRefreshCandidates(manifest, assets);
    if (!apply)
      return { mode: 'plan', count: assets.length, assetIds: assets.map((asset) => asset.id) };
    const updated: string[] = [];
    for (const asset of assets) {
      const directory = await mkdtemp(join(tmpdir(), 'sekereagle-photo-metadata-'));
      const original = join(directory, 'original');
      try {
        const object = await storage.send(
          new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: asset.originalObjectKey }),
        );
        if (!object.Body) throw new Error('Original unavailable');
        const hash = createHash('sha256');
        let size = 0;
        const tap = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > CAMERA_MAX_IMAGE_BYTES)
              return callback(new Error('Original exceeds metadata budget'));
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(object.Body as Readable, tap, createWriteStream(original, { flags: 'wx' }));
        if (hash.digest('hex') !== asset.sha256 || BigInt(size) !== asset.byteSize)
          throw new Error('Original checksum mismatch');
        const metadata = await readPhotoExif(undefined, original);
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "EagleAsset" WHERE "id"=${asset.id} AND "ownerId"=${asset.ownerId} AND "libraryMode"='PHOTO' FOR UPDATE`;
          const fresh = await tx.eagleAsset.findFirst({
            where: { id: asset.id, ownerId: asset.ownerId, libraryMode: 'PHOTO' },
            include: { photoMetadata: true },
          });
          assertPhotoMetadataRefreshCandidates(
            [{ assetId: asset.id, sha256: asset.sha256!, mediaRevision: asset.mediaRevision }],
            fresh ? [fresh] : [],
          );
          const previous = fresh!.photoMetadata;
          if (
            !previous ||
            previous.assetRevision !== asset.mediaRevision ||
            previous.sharpnessScore === null ||
            !previous.perceptualHash
          )
            throw new Error('Current pixel analysis is required before metadata refresh');
          await persistPhotoAnalysis(
            tx,
            fresh!,
            {
              ...metadata,
              sharpnessScore: previous.sharpnessScore,
              perceptualHash: previous.perceptualHash,
            },
            asset.mediaRevision,
          );
        });
        updated.push(asset.id);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    return { mode: 'applied', count: updated.length, assetIds: updated };
  } finally {
    await prisma.$disconnect();
    storage.destroy();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args[0] || args.length > 2 || (args[1] && args[1] !== '--apply'))
    throw new Error('Supply a manifest file and optional --apply');
  void readFile(args[0], 'utf8')
    .then((text) =>
      refreshPhotoMetadata(
        validatePhotoMetadataRefreshManifest(JSON.parse(text)),
        args[1] === '--apply',
      ),
    )
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Photo metadata refresh failed');
      process.exitCode = 1;
    });
}
