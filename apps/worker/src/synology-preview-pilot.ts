import { PrismaClient, type Prisma } from '@prisma/client';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertSafeRuntimeTarget } from '@sekereagle/config';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { loadCachedImage, verifyCachedImageSource, type CachedImageSource } from './cached-image';
import {
  validatePhotoMaintenanceManifest,
  assertPhotoMaintenanceCandidates,
  type RefreshItem,
} from './photo-maintenance-scope';
import { claimNextMediaJob } from './job-claim';
import { publishImage } from './image-publication';
import { analyzePhotoPixels, readPhotoExif } from './photo-analysis';
import { inspectLivePhotoImage } from './live-photo';

interface Manifest {
  ownerId: string;
  items: Array<RefreshItem & { source: CachedImageSource }>;
}

/** Bounded one-shot input adapter. Existing managed originals and completed covers are untouched. */
async function run(manifest: Manifest, root: string, apply: boolean) {
  assertSafeRuntimeTarget({
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3Endpoint: process.env.S3_ENDPOINT ?? '',
    s3Bucket: process.env.S3_BUCKET ?? '',
  });
  const scope = validatePhotoMaintenanceManifest(
    manifest.items.map(({ assetId, sha256, mediaRevision }) => ({
      assetId,
      sha256,
      mediaRevision,
    })),
  );
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
  const report: unknown[] = [];
  try {
    const assets = await prisma.eagleAsset.findMany({
      where: {
        ownerId: manifest.ownerId,
        libraryMode: 'PHOTO',
        id: { in: scope.map((x) => x.assetId) },
      },
      include: {
        photoMetadata: true,
        renditions: { where: { status: 'READY', kind: 'PREVIEW', variant: 'default' } },
      },
    });
    assertPhotoMaintenanceCandidates(scope, assets);
    for (const item of manifest.items) {
      const started = Date.now();
      const asset = assets.find((x) => x.id === item.assetId)!;
      try {
        if (asset.renditions.length) {
          report.push({ assetId: asset.id, status: 'ALREADY_READY' });
          continue;
        }
        const cached = await loadCachedImage(root, item.source);
        if (
          !asset.width ||
          !asset.height ||
          Math.abs(
            cached.renditions[2]!.width /
              cached.renditions[2]!.height /
              (asset.width / asset.height) -
              1,
          ) > 0.02
        )
          throw new Error('SOURCE_CACHE_ASPECT');
        const details = {
          assetId: asset.id,
          dimensions: cached.renditions.map((x) => ({
            kind: x.kind,
            variant: x.variant,
            width: x.width,
            height: x.height,
            bytes: x.data.length,
          })),
        };
        if (!apply) {
          report.push({
            ...details,
            status: 'VALIDATED',
            ms: Date.now() - started,
          });
          continue;
        }
        // This initial pilot deliberately leaves RAW editing semantics to the existing decoder.
        if (!['image/jpeg', 'image/heic', 'image/heif'].includes(asset.mimeType))
          throw new Error('PILOT_FORMAT');
        if (!asset.originalObjectKey.startsWith(`users/${asset.ownerId}/`))
          throw new Error('ORIGINAL_SCOPE');
        const head = await storage.send(
          new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: asset.originalObjectKey }),
        );
        if (BigInt(head.ContentLength ?? -1) !== asset.byteSize)
          throw new Error('MANAGED_ORIGINAL_SIZE');
        const livePhoto = await inspectLivePhotoImage(cached.originalPath);
        if (livePhoto.motion) throw new Error('PILOT_MOTION_DEFERRED');
        const photoAnalysis = {
          ...(await readPhotoExif(undefined, cached.originalPath)),
          ...(await analyzePhotoPixels(sharp(cached.renditions[2]!.data))),
        };
        const jobScope = {
          ownerId: asset.ownerId,
          libraryMode: 'PHOTO' as const,
          assetId: asset.id,
          assetRevision: item.mediaRevision,
          kind: 'GENERATE_RENDITIONS' as const,
        };
        // Explicit retry of these exact revisions only; retain attempt and lease history.
        await prisma.eagleAssetProcessingJob.updateMany({
          where: { ...jobScope, status: 'PENDING' },
          data: { availableAt: new Date() },
        });
        const job = await claimNextMediaJob(
          {
            eagleAssetProcessingJob: {
              findMany: (args) =>
                prisma.eagleAssetProcessingJob.findMany({
                  ...args,
                  where: { ...args.where, ...jobScope },
                }),
              updateMany: (args) =>
                prisma.eagleAssetProcessingJob.updateMany({
                  ...args,
                  where: { ...args.where, ...jobScope },
                }),
              findUniqueOrThrow: (args) => prisma.eagleAssetProcessingJob.findUniqueOrThrow(args),
            },
          },
          {
            allowedJobKinds: ['GENERATE_RENDITIONS'],
            canClaimBackground: () => Promise.resolve(true),
          },
        );
        if (!job) throw new Error('NO_ELIGIBLE_RENDITION_LEASE');
        try {
          const renditions: Prisma.EagleAssetRenditionUncheckedCreateInput[] = [];
          for (const image of cached.renditions) {
            const storageKey = `users/${asset.ownerId}/assets/${asset.id}/renditions/${item.mediaRevision}/${image.kind.toLowerCase()}-${image.variant}.jpg`;
            await storage.send(
              new PutObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: storageKey,
                Body: image.data,
                ContentType: image.mimeType,
              }),
            );
            renditions.push({
              ownerId: asset.ownerId,
              libraryMode: 'PHOTO',
              assetId: asset.id,
              kind: image.kind,
              variant: image.variant,
              revision: item.mediaRevision,
              storageKey,
              mimeType: image.mimeType,
              width: image.width,
              height: image.height,
              byteSize: BigInt(image.data.length),
              status: 'READY',
            });
          }
          await verifyCachedImageSource(root, item.source);
          const published = await publishImage(prisma, {
            asset,
            job,
            renditions,
            sha256: item.sha256,
            dimensions: { width: asset.width, height: asset.height },
            photoAnalysis,
            livePhoto,
            scheduleFaces: false,
          });
          if (!published) throw new Error('PUBLICATION_STALE');
          report.push({ ...details, status: 'COPIED', ms: Date.now() - started });
        } catch (error) {
          await prisma.eagleAssetProcessingJob.updateMany({
            where: {
              ...jobScope,
              id: job.id,
              status: 'PROCESSING',
              leaseVersion: job.leaseVersion,
            },
            data: {
              status: 'PENDING',
              lockedAt: null,
              availableAt: new Date(Date.now() + 60000),
              lastError: 'SYNOPHOTO_PILOT_RETRY',
            },
          });
          throw error;
        }
      } catch (error) {
        report.push({
          assetId: asset.id,
          status: 'SKIPPED',
          reason: error instanceof Error ? error.message : 'UNKNOWN',
        });
      }
    }
    return { mode: apply ? 'apply' : 'plan', count: scope.length, report };
  } finally {
    storage.destroy();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const [path, root, mode] = process.argv.slice(2);
  if (!path || !root || !['--plan', '--apply'].includes(mode ?? ''))
    throw new Error('Expected manifest, read-only source root and --plan/--apply');
  void readFile(path, 'utf8')
    .then((text) => run(JSON.parse(text) as Manifest, root, mode === '--apply'))
    .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch((error: unknown) => {
      process.stderr.write((error instanceof Error ? error.message : 'PILOT_FAILED') + '\n');
      process.exitCode = 1;
    });
}
