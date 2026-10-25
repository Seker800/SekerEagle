import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectJpegLivePhoto } from './live-photo';

test('static JPEG inspection reads a bounded header, never the full original', async () => {
  const requests: number[][] = [];
  const result = await inspectJpegLivePhoto(30_000_000, async (start, length) => {
    requests.push([start, length]);
    const bytes = Buffer.alloc(length);
    bytes[0] = 255;
    bytes[1] = 216;
    return bytes;
  });
  assert.deepEqual(requests, [[0, 1024 * 1024]]);
  assert.equal(result.motion, null);
});

test('motion JPEG reads only the header and validated video range', async () => {
  const requests: number[][] = [];
  const motion = Buffer.alloc(20, 7);
  const result = await inspectJpegLivePhoto(
    30_000_000,
    async (start, length) => {
      requests.push([start, length]);
      if (start) return motion;
      const header = Buffer.alloc(length);
      header[0] = 255;
      header[1] = 216;
      header.write('<x GCamera:MicroVideo="1" GCamera:MicroVideoOffset="20"/>', 2);
      return header;
    },
    async (bytes) => {
      assert.deepEqual(bytes, motion);
      return { data: Buffer.from('video'), width: 32, height: 24 };
    },
  );
  assert.deepEqual(requests, [
    [0, 1024 * 1024],
    [29_999_980, 20],
  ]);
  assert.equal(result.motion?.width, 32);
});

test('invalid offsets never trigger a video read, short reads and storage errors fail for retry', async () => {
  let reads = 0;
  await inspectJpegLivePhoto(100, async (_start, length) => {
    reads++;
    const head = Buffer.alloc(length);
    head[0] = 255;
    head[1] = 216;
    head.write('<x GCamera:MicroVideo="1" GCamera:MicroVideoOffset="999"/>', 2);
    return head;
  });
  assert.equal(reads, 1);
  await assert.rejects(
    () => inspectJpegLivePhoto(100, async () => Buffer.alloc(2)),
    /RANGE_LENGTH/,
  );
  await assert.rejects(
    () =>
      inspectJpegLivePhoto(100, async () => {
        throw new Error('offline');
      }),
    /offline/,
  );
});

test('HEIC source inspection streams without decoding, and still verifies the original hash', async () => {
  const { inspectLivePhotoStream } = await import('./live-photo');
  const { createHash } = await import('node:crypto');
  // A valid small HEIF ftyp box without metadata or video; image decoding would reject it.
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24);
  bytes.write('ftyp', 4);
  bytes.write('heic', 8);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const source = async function* () {
    yield bytes.subarray(0, 5);
    yield bytes.subarray(5);
  };
  assert.deepEqual(await inspectLivePhotoStream(source(), hash), {
    identifier: null,
    motion: null,
  });
  await assert.rejects(() => inspectLivePhotoStream(source(), '0'.repeat(64)), /HASH_MISMATCH/);
  await assert.rejects(
    () =>
      inspectLivePhotoStream(
        (async function* () {
          throw new Error('offline');
          yield bytes;
        })(),
        hash,
      ),
    /offline/,
  );
});

function appleJpeg() {
  const maker = Buffer.alloc(72);
  maker.write('Apple iOS\0');
  maker.write('II', 12);
  maker.writeUInt16LE(1, 14);
  maker.writeUInt16LE(17, 16);
  maker.writeUInt16LE(2, 18);
  maker.writeUInt32LE(37, 20);
  maker.writeUInt32LE(32, 24);
  maker.write('c94808dc-251e-40b0-b2a3-85b23134c526', 32);
  const tiff = Buffer.alloc(116);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x927c, 28);
  tiff.writeUInt16LE(7, 30);
  tiff.writeUInt32LE(72, 32);
  tiff.writeUInt32LE(44, 36);
  maker.copy(tiff, 44);
  const app = Buffer.alloc(4);
  app[0] = 255;
  app[1] = 225;
  app.writeUInt16BE(2 + 6 + tiff.length, 2);
  return Buffer.concat([
    Buffer.from([255, 216]),
    app,
    Buffer.from('Exif\0\0'),
    tiff,
    Buffer.from([255, 217]),
  ]);
}

test('ranged JPEG inspection preserves Apple identity even after large preceding metadata', async () => {
  const jpeg = appleJpeg();
  const padding = Buffer.alloc(65537);
  padding[0] = 255;
  padding[1] = 226;
  padding.writeUInt16BE(65535, 2);
  const original = Buffer.concat([
    jpeg.subarray(0, 2),
    ...Array<Buffer>(20).fill(padding),
    jpeg.subarray(2),
  ]);
  const result = await inspectJpegLivePhoto(original.length, async (start, length) =>
    original.subarray(start, start + length),
  );
  assert.equal(result.identifier, 'c94808dc-251e-40b0-b2a3-85b23134c526');
});
