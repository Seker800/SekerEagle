import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { PrismaClient, EagleAssetProcessingJob } from '@prisma/client';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { renderEditedCopy } from './edited-copy-render';

test('a lost render lease cannot publish a copy and retains durable cleanup for its uploaded object', async () => {
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#abc' } })
    .png()
    .toBuffer();
  const events: string[] = [];
  const source = {
    id: 'source',
    ownerId: 'owner',
    libraryMode: 'MATERIAL',
    mediaRevision: 1,
    rowVersion: 3,
    mimeType: 'image/png',
    originalObjectKey: 'users/owner/assets/source/original.png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const tx = {
    $queryRaw: async () => [],
    eagleAsset: { findFirst: async () => source },
    eagleAssetProcessingJob: { updateMany: async () => ({ count: 0 }) },
  };
  const db = {
    eagleEditRender: {
      findFirst: async () => ({
        sourceRowVersion: 3,
        recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS },
      }),
    },
    eagleAsset: { findFirst: async () => source },
    eagleObjectDeletion: {
      create: async () => {
        events.push('outbox');
        return { id: 'orphan' };
      },
      updateMany: async () => {
        events.push('cleanup-retry');
        return { count: 1 };
      },
    },
    $transaction: async (run: (value: unknown) => Promise<boolean>) => run(tx),
  } as unknown as PrismaClient;
  const storage = {
    send: async (command: unknown) => {
      if (command instanceof GetObjectCommand) return { Body: Readable.from([bytes]) };
      assert.ok(command instanceof PutObjectCommand);
      events.push('put');
      return {};
    },
  } as unknown as S3Client;
  await renderEditedCopy(db, storage, 'sekereagle-assets', {
    id: 'job',
    ownerId: 'owner',
    libraryMode: 'MATERIAL',
    assetId: 'source',
    assetRevision: 1,
    leaseVersion: 1,
  } as EagleAssetProcessingJob);
  assert.deepEqual(events, ['outbox', 'put', 'cleanup-retry']);
});
test('source scope is verified before an original can be read', async () => {
  let reads = 0;
  const db = {
    eagleEditRender: { findFirst: async () => ({ sourceRowVersion: 1 }) },
    eagleAsset: {
      findFirst: async () => ({
        rowVersion: 1,
        originalObjectKey: 'users/another/assets/private/source.png',
      }),
    },
  } as unknown as PrismaClient;
  const storage = {
    send: () => {
      reads++;
    },
  } as unknown as S3Client;
  await assert.rejects(
    renderEditedCopy(db, storage, 'sekereagle-assets', {
      ownerId: 'owner',
      libraryMode: 'PHOTO',
    } as EagleAssetProcessingJob),
    /EDIT_SOURCE_SCOPE/,
  );
  assert.equal(reads, 0);
});

test('a HEIC source is decoded by the bounded native decoder and rendered into a PNG copy', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-heic-edit-'));
  const info = join(directory, 'info'),
    decode = join(directory, 'decode');
  const decoded = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#8a6a4a' },
  })
    .png()
    .toBuffer();
  await writeFile(
    info,
    `#!${process.execPath}\nconsole.log('MIME type: image/heic\\nimage: 32x24 (id=1), primary');`,
    { mode: 0o700 },
  );
  await writeFile(
    decode,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.argv[3], Buffer.from('${decoded.toString('base64')}', 'base64'));`,
    { mode: 0o700 },
  );
  const previousInfo = process.env.HEIF_INFO_PATH,
    previousDecode = process.env.HEIF_CONVERT_PATH;
  process.env.HEIF_INFO_PATH = info;
  process.env.HEIF_CONVERT_PATH = decode;
  const sourceBytes = Buffer.from('synthetic-heic-container');
  const source = {
    id: 'source',
    ownerId: 'owner',
    libraryMode: 'MATERIAL',
    mediaRevision: 1,
    rowVersion: 2,
    mimeType: 'image/heic',
    originalObjectKey: 'users/owner/assets/source/original.heic',
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  };
  const events: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => [],
    eagleAsset: { findFirst: async () => source },
    eagleAssetProcessingJob: { updateMany: async () => ({ count: 0 }) },
  };
  const db = {
    eagleEditRender: {
      findFirst: async () => ({
        sourceRowVersion: 2,
        recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS },
      }),
    },
    eagleAsset: { findFirst: async () => source },
    eagleObjectDeletion: {
      create: async () => {
        events.push('outbox');
        return { id: 'orphan' };
      },
      updateMany: async () => {
        events.push('cleanup-retry');
        return { count: 1 };
      },
    },
    $transaction: async (run: (value: unknown) => Promise<boolean>) => run(tx),
  } as unknown as PrismaClient;
  const storage = {
    send: async (command: unknown) => {
      if (command instanceof GetObjectCommand) return { Body: Readable.from([sourceBytes]) };
      assert.ok(command instanceof PutObjectCommand);
      events.push('put');
      return {};
    },
  } as unknown as S3Client;
  try {
    await renderEditedCopy(db, storage, 'sekereagle-assets', {
      id: 'job',
      ownerId: 'owner',
      libraryMode: 'MATERIAL',
      assetId: 'source',
      assetRevision: 1,
      leaseVersion: 1,
    } as EagleAssetProcessingJob);
    assert.deepEqual(events, ['outbox', 'put', 'cleanup-retry']);
  } finally {
    if (previousInfo === undefined) delete process.env.HEIF_INFO_PATH;
    else process.env.HEIF_INFO_PATH = previousInfo;
    if (previousDecode === undefined) delete process.env.HEIF_CONVERT_PATH;
    else process.env.HEIF_CONVERT_PATH = previousDecode;
    await rm(directory, { recursive: true, force: true });
  }
});
