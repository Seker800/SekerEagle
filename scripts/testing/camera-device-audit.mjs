/** Local, opt-in real-camera verification; samples are never bundled or uploaded. */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { cameraMediaFormat, CAMERA_MAX_IMAGE_PIXELS } from '@sekereagle/library-core';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const require = createRequire(import.meta.url);
const {
  EagleUploadInspectionService,
} = require('../../apps/api/dist/eagle/eagle-upload-inspection.service.js');
const { withProcessableImage } = require('../../apps/worker/dist/image-media.js');
const {
  imageRenditionSpecs,
  catalogImageDimensions,
} = require('../../apps/worker/dist/image-renditions.js');
assertSafeRuntimeTarget({
  databaseUrl: 'postgresql://localhost:5432/sekereagle_test',
  s3Endpoint: 'http://localhost:9000',
  s3Bucket: 'sekereagle-test',
});
const paths = process.argv.slice(2);
assert.ok(paths.length, 'Pass local RAW sample paths explicitly.');
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const cases = [];
for (const name of paths) {
  const path = resolve(name),
    started = Date.now();
  try {
    const format = cameraMediaFormat(path);
    assert.equal(format?.kind, 'raw');
    const before = await sha256(path);
    const inspection = new EagleUploadInspectionService({
      getObject: async () => ({ Body: createReadStream(path) }),
    });
    const inspected = await inspection.inspect(basename(path), format.mimeType);
    assert.equal(inspected.sha256, before);
    const processed = await withProcessableImage(
      createReadStream(path),
      format.mimeType,
      basename(path),
      async (image, _, original) => {
        const decoded = await image.clone().metadata();
        assert.ok(decoded.width * decoded.height <= CAMERA_MAX_IMAGE_PIXELS);
        assert.deepEqual(catalogImageDimensions(decoded, original), {
          width: inspected.width,
          height: inspected.height,
        });
        const outputs = [];
        for (const spec of imageRenditionSpecs(format.mimeType)) {
          const { info } = await image
            .clone()
            .rotate()
            .resize({
              width: spec.maxSize,
              height: spec.maxSize,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp(spec.encoding)
            .toBuffer({ resolveWithObject: true });
          assert.ok(Math.max(info.width, info.height) <= spec.maxSize);
          outputs.push({ variant: spec.variant, width: info.width, height: info.height });
        }
        return { decodedWidth: decoded.width, decodedHeight: decoded.height, outputs };
      },
    );
    assert.equal(processed.sha256, before);
    assert.equal(await sha256(path), before);
    cases.push({
      name: basename(path),
      sampleGroup: basename(dirname(path)),
      sha256: before,
      original: { width: inspected.width, height: inspected.height },
      ...processed.result,
      originalUnchanged: true,
      elapsedMs: Date.now() - started,
    });
    process.stdout.write(`PASS ${basename(path)} ${inspected.width}x${inspected.height}\n`);
  } catch (error) {
    cases.push({ name: basename(path), error: error.message });
    process.stderr.write(`FAIL ${basename(path)}: ${error.message}\n`);
  }
}
await mkdir('.omx/artifacts', { recursive: true });
await writeFile('.omx/artifacts/camera-device-audit.json', JSON.stringify({ cases }, null, 2));
assert.ok(
  cases.every((row) => !row.error),
  'Some real-camera cases failed.',
);
