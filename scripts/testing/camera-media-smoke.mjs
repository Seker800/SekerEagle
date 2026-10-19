import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Buffer } from 'node:buffer';
import { basename } from 'node:path';
import { cameraMediaFormat } from '@sekereagle/library-core';
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { probeCameraVideo, transcodeCameraVideo } from '@sekereagle/media-core';
import { createCameraFixtures } from './camera-media-fixtures.mjs';
const require = createRequire(import.meta.url);
const run = promisify(execFile);
const {
  EagleUploadInspectionService,
} = require('../../apps/api/dist/eagle/eagle-upload-inspection.service.js');
const { withProcessableImage } = require('../../apps/worker/dist/image-media.js');
assertSafeRuntimeTarget({
  databaseUrl: 'postgresql://localhost:5432/sekereagle_test',
  s3Endpoint: 'http://localhost:9000',
  s3Bucket: 'sekereagle-test',
});
// Numerical camera calibration tests require the same native runtime as decoding.
await run(process.env.CAMERA_RAW_PYTHON || 'python3', [
  '-m',
  'unittest',
  'discover',
  '-s',
  'packages/media-core/python',
  '-p',
  'test_raw_color.py',
]);
const directory = resolve('.omx/test-camera/smoke');
await rm(directory, { recursive: true, force: true });
const files = await createCameraFixtures(directory);
if (process.env.CAMERA_TEST_RAW) {
  const path = resolve(process.env.CAMERA_TEST_RAW);
  const format = cameraMediaFormat(path);
  assert.equal(format?.kind, 'raw');
  files.push({ name: basename(path), path, mimeType: format.mimeType });
}
const cases = [];
for (const file of files) {
  const before = createHash('sha256')
    .update(await readFile(file.path))
    .digest('hex');
  const service = new EagleUploadInspectionService({
    getObject: async () => ({ Body: createReadStream(file.path) }),
  });
  const inspected = await service.inspect(file.name, file.mimeType);
  assert.equal(inspected.sha256, before);
  let preview;
  if (file.codec) {
    const metadata = await probeCameraVideo(file.path, file.mimeType);
    preview = await transcodeCameraVideo(
      file.path,
      join(directory, `${file.name}.mp4`),
      metadata.durationMs,
    );
    const { stdout } = await run(
      process.env.FFPROBE_PATH || 'ffprobe',
      ['-v', 'error', '-show_streams', '-of', 'json', join(directory, `${file.name}.mp4`)],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const streams = JSON.parse(stdout).streams;
    const video = streams.find((stream) => stream.codec_type === 'video');
    assert.equal(video.codec_name, 'h264');
    assert.ok(['yuv420p', 'yuvj420p'].includes(video.pix_fmt), '8-bit 4:2:0 browser playback');
    if (file.audio)
      assert.equal(streams.find((stream) => stream.codec_type === 'audio')?.codec_name, 'aac');
  } else {
    const result = await withProcessableImage(
      createReadStream(file.path),
      file.mimeType,
      file.name,
      async (image) => {
        const preview = await image
          .clone()
          .rotate()
          .resize({ width: 512, height: 512, fit: 'inside' })
          .webp()
          .toBuffer({ resolveWithObject: true });
        return { width: preview.info.width, height: preview.info.height };
      },
    );
    assert.equal(result.sha256, before);
    preview = result.result;
  }
  assert.equal(
    createHash('sha256')
      .update(await readFile(file.path))
      .digest('hex'),
    before,
  );
  cases.push({ name: file.name, mimeType: file.mimeType, inspected, preview });
}
const fake = new EagleUploadInspectionService({
  getObject: async () => ({ Body: Readable.from([Buffer.from('not a camera file')]) }),
});
await assert.rejects(fake.inspect('spoof.dng', 'image/x-adobe-dng'));
await assert.rejects(fake.inspect('spoof.mov', 'video/quicktime'));
await mkdir('.omx/artifacts', { recursive: true });
await writeFile(
  '.omx/artifacts/camera-media-smoke.json',
  JSON.stringify({ status: 'passed', cases, spoofRejected: true }, null, 2),
);
process.stdout.write(
  `Camera media smoke passed: ${cases.length} formats, original hashes unchanged, spoofed files rejected.\n`,
);
