import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { processVideo } from './video-processing';
import { VIDEO_PLAYBACK_PROCESSOR_VERSION } from './video-processing-policy';

test('video poster, deferred playback and normal full processing preserve scoped publication and leases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-stage-test-'));
  const previousProbe = process.env.FFPROBE_PATH,
    previousEncode = process.env.FFMPEG_PATH;
  const probe = join(dir, 'probe'),
    encode = join(dir, 'encode'),
    calls = join(dir, 'calls');
  const jpeg = await sharp({
    create: { width: 16, height: 12, channels: 3, background: '#334455' },
  })
    .jpeg()
    .toBuffer();
  await writeFile(
    probe,
    `#!${process.execPath}\nconsole.log(JSON.stringify({format:{format_name:'mov,mp4',duration:'1'},streams:[{codec_type:'video',codec_name:'h264',width:32,height:24}]}));`,
    { mode: 0o700 },
  );
  await writeFile(
    encode,
    `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},process.argv.includes('libx264')?'PLAYBACK\\n':'POSTER\\n');fs.writeFileSync(process.argv.at(-1),process.argv.at(-1).endsWith('.jpg')?Buffer.from('${jpeg.toString('base64')}','base64'):Buffer.from('preview'));`,
    { mode: 0o700 },
  );
  process.env.FFPROBE_PATH = probe;
  process.env.FFMPEG_PATH = encode;
  try {
    for (const [kind, enabled, claimed, expected] of [
      ['GENERATE_THUMBNAIL', false, true, ['THUMBNAIL']],
      ['GENERATE_PREVIEW', true, true, ['PREVIEW']],
      ['GENERATE_THUMBNAIL', true, true, ['PREVIEW', 'THUMBNAIL']],
      ['GENERATE_THUMBNAIL', false, false, []],
    ] as const) {
      await writeFile(calls, '');
      const publications: Record<string, unknown>[] = [];
      const deferred: Record<string, unknown>[] = [];
      const updates: Record<string, unknown>[] = [];
      const tx = {
        $queryRaw: async () => [],
        $executeRaw: async () => 0,
        eagleAssetProcessingJob: {
          updateMany: async () => ({ count: claimed ? 1 : 0 }),
          createMany: async (input: Record<string, unknown>) => {
            deferred.push(input);
          },
        },
        eagleAssetRendition: {
          upsert: async (input: { create: Record<string, unknown> }) => {
            publications.push(input.create);
          },
        },
        eagleAsset: {
          updateMany: async (input: Record<string, unknown>) => {
            updates.push(input);
            return { count: 1 };
          },
        },
      };
      const prisma = {
        $transaction: async (work: (transaction: typeof tx) => Promise<void>) => work(tx),
      };
      const storage = {
        send: async (command: { input: { Body?: AsyncIterable<Uint8Array> | Buffer } }) => {
          if (command instanceof GetObjectCommand)
            return { Body: Readable.from([Buffer.from('original')]) };
          if (command.input.Body && !Buffer.isBuffer(command.input.Body))
            for await (const chunk of command.input.Body) assert.ok(chunk.length);
          return {};
        },
      };
      let verified = false;
      await processVideo(
        { id: 'job', kind, assetRevision: 3, leaseVersion: 2 } as never,
        {
          id: 'asset',
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          mimeType: 'video/mp4',
          originalObjectKey: 'users/owner/original',
          uploadSessions: [],
        },
        {
          prisma: prisma as never,
          storage: storage as never,
          s3Bucket: 'sekereagle-assets',
          transcodingEnabled: enabled,
          lockPrivacy: async (_transaction, owner, mode) => {
            assert.equal(owner, 'owner');
            assert.equal(mode, 'PHOTO');
          },
          syncPrivacy: async () => 0,
          assertExpectedHash: () => {
            verified = true;
          },
        },
      );
      assert.equal(verified, true);
      assert.deepEqual(
        publications.map((x) => x.kind),
        expected,
      );
      assert.ok(
        publications.every(
          (x) => x.ownerId === 'owner' && x.libraryMode === 'PHOTO' && x.revision === 3,
        ),
      );
      if (!enabled) assert.doesNotMatch(await readFile(calls, 'utf8'), /PLAYBACK/);
      assert.equal(deferred.length, claimed && !enabled ? 1 : 0);
      if (deferred.length)
        assert.equal(
          (deferred[0]!.data as { processorVersion: string }[])[0]!.processorVersion,
          VIDEO_PLAYBACK_PROCESSOR_VERSION,
        );
      assert.equal(updates.length, claimed && kind !== 'GENERATE_PREVIEW' ? 1 : 0);
    }
  } finally {
    if (previousProbe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = previousProbe;
    if (previousEncode === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousEncode;
    await rm(dir, { recursive: true, force: true });
  }
});
