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
