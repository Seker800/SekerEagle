import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';
import { EagleUploadInspectionService } from './eagle-upload-inspection.service';

test('upload inspection streams image hashing and enforces the declared format', async () => {
  const png = await sharp({
    create: { width: 12, height: 8, channels: 4, background: '#336699' },
  })
    .png()
    .toBuffer();
  const service = new EagleUploadInspectionService({
    getObject: async () => ({ Body: Readable.from([png]) }),
  } as never);

  const result = await service.inspect('users/owner-a/assets/id/original.png', 'image/png');

  assert.equal(result.format, 'png');
  assert.equal(result.width, 12);
  assert.equal(result.height, 8);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    service.inspect('users/owner-a/assets/id/original.png', 'image/jpeg'),
    /格式不匹配/,
  );
});

test('upload inspection accepts real AVIF bytes but rejects a mismatched declaration', async () => {
  const avif = await sharp({
    create: { width: 10, height: 6, channels: 3, background: '#663399' },
  })
    .avif()
    .toBuffer();
  const service = new EagleUploadInspectionService({
    getObject: async () => ({ Body: Readable.from([avif]) }),
  } as never);

  const result = await service.inspect('users/owner-a/assets/id/original.avif', 'image/avif');

  assert.equal(result.format, 'heif');
  assert.equal(result.width, 10);
  assert.equal(result.height, 6);
  await assert.rejects(
    service.inspect('users/owner-a/assets/id/original.avif', 'image/webp'),
    /格式不匹配/,
  );
});
