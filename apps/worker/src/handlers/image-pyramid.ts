import { PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaOutputAttempt } from '../media-output-attempt';
import { publishPyramid } from '../pyramid-publication';
import { parseDeepZoomTilePath } from '../image-pyramid';
import { renderPyramidWork } from '../pyramid-work';
import { assertExpectedHash } from './shared';
import type { JobMediaAsset } from './job-asset';
import type { JobExecution } from './types';

export async function generateImagePyramid(
  { job, remoteRequired, context }: JobExecution,
  asset: JobMediaAsset,
  sourceBody: AsyncIterable<Uint8Array>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-pyramid-'));
  const outputAttempt = new MediaOutputAttempt(
    context.prisma,
    { ...asset, mediaRevision: job.assetRevision },
    'pyramids',
  );
  const storagePrefix = outputAttempt.prefix.replace(/\/+$/, '');
  let published = false;
  try {
    const output = remoteRequired
      ? await context.remoteMediaClient.pyramid(sourceBody, asset.mimeType, directory)
      : await renderPyramidWork(sourceBody, asset.mimeType, asset.originalObjectKey, directory);
    const { descriptor: result, sha256, tileDirectory } = output;
    assertExpectedHash(asset.uploadSessions[0]?.eagleState?.expectedContentSha256, sha256);

    const tilePaths = output.files.map((name) => join(tileDirectory, name));
    let byteSize = 0n;
    await outputAttempt.prepare();
    await runBoundedWork(tilePaths, 4, async (filePath) => {
      const relativePath = filePath.slice(tileDirectory.length + 1);
      const tile = parseDeepZoomTilePath(relativePath);
      const details = await stat(filePath);
      byteSize += BigInt(details.size);
      await context.storage.send(
        new PutObjectCommand({
          Bucket: context.s3Bucket,
          Key: `${storagePrefix}/${tile.relativeKey}`,
          Body: await readFile(filePath),
          ContentType: 'image/webp',
        }),
      );
    });

    published = await publishPyramid(context.prisma, {
      job,
      descriptor: result,
      storagePrefix,
      tileCount: tilePaths.length,
      byteSize,
      outputAttempt,
    });
  } finally {
    try {
      await outputAttempt.finish(published);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function runBoundedWork<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          await work(items[index]!);
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    }),
  );
  if (failed) throw failure;
}
