import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';
import { EagleMediaService } from './eagle-media.service';
import { renderShareJpeg } from './eagle-share-image';

function httpStatus(error: unknown): number | undefined {
  const candidate = error as { status?: number; getStatus?: () => number };
  return candidate.getStatus?.() ?? candidate.status;
}

async function createJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 70, b: 40 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

test('share image render stays owner-scoped and returns a bounded JPEG', async () => {
  const source = await createJpeg(1_200, 800);
  let query: unknown;
  const service = new EagleMediaService(
    {
      eagleAsset: {
        findFirst: async (input: unknown) => {
          query = input;
          return {
            originalObjectKey: 'users/owner-a/assets/asset-1/original.jpg',
            mimeType: 'image/jpeg',
          };
        },
      },
    } as never,
    {
      getObject: async () => ({ Body: Readable.from([source]), ContentLength: source.length }),
    } as never,
    'MATERIAL',
  );

  const rendered = await service.renderShareImage('owner-a', 'asset-1');

  assert.deepEqual(query, {
    where: {
      ownerId: 'owner-a',
      id: 'asset-1',
      purgeAfter: null,
      isPrivate: false,
      libraryMode: 'MATERIAL',
    },
    select: { originalObjectKey: true, mimeType: true },
  });
  assert.equal(rendered.width, 1_200);
  assert.equal(rendered.height, 800);
  assert.equal(rendered.buffer.subarray(0, 2).toString('hex'), 'ffd8');
  assert.ok(rendered.byteSize <= 15 * 1024 * 1024);
});

test('share image render refuses non-image assets', async () => {
  const service = new EagleMediaService(
    {
      eagleAsset: {
        findFirst: async () => ({
          originalObjectKey: 'users/owner-a/assets/asset-1/original.mp4',
          mimeType: 'video/mp4',
        }),
      },
    } as never,
    {} as never,
    'MATERIAL',
  );

  await assert.rejects(service.renderShareImage('owner-a', 'asset-1'), (error) => {
    assert.equal(httpStatus(error), 400);
    return true;
  });
});

test('share image render hides cross-owner and private assets as not found', async () => {
  const service = new EagleMediaService(
    { eagleAsset: { findFirst: async () => null } } as never,
    {} as never,
    'PHOTO',
  );

  await assert.rejects(service.renderShareImage('owner-b', 'asset-1', false), (error) => {
    assert.equal(httpStatus(error), 404);
    return true;
  });
});

test('share encoding lowers quality and then dimensions to stay under the byte ceiling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-share-test-'));
  try {
    const noise = randomBytes(1_600 * 1_067 * 3);
    const source = await sharp(noise, { raw: { width: 1_600, height: 1_067, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const path = join(directory, 'noise.jpg');
    await writeFile(path, source);
    const rendered = await renderShareJpeg(path, {
      maxEdge: 1_600,
      maxBytes: 300 * 1024,
      minQuality: 60,
    });
    assert.ok(rendered.byteSize <= 300 * 1024);
    assert.ok(rendered.width < 1_600);
    assert.equal(rendered.buffer.subarray(0, 2).toString('hex'), 'ffd8');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
