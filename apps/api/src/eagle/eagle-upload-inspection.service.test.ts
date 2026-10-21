import { join } from 'node:path';
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

test('HEIC upload uses the guarded native decoder and hashes the untouched source', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(join(tmpdir(), 'heif-inspection-test-'));
  const oldInfo = process.env.HEIF_INFO_PATH,
    oldDecode = process.env.HEIF_CONVERT_PATH;
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
  const info = join(dir, 'info'),
    decode = join(dir, 'decode');
  await writeFile(
    info,
    `#!${process.execPath}\nconsole.log('MIME type: image/heic\\nimage: 12x8 (id=1), primary');`,
    { mode: 0o700 },
  );
  await writeFile(
    decode,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.argv.at(-1),Buffer.from('${png.toString('base64')}','base64'));`,
    { mode: 0o700 },
  );
  process.env.HEIF_INFO_PATH = info;
  process.env.HEIF_CONVERT_PATH = decode;
  const source = Buffer.from('synthetic-heic');
  const service = new EagleUploadInspectionService({
    getObject: async () => ({ Body: Readable.from([source]) }),
  } as never);
  try {
    const result = await service.inspect('users/owner/assets/id/original.heic', 'image/heic');
    assert.equal(result.width, 12);
    assert.equal(result.height, 8);
    assert.equal(result.format, 'heif');
    assert.equal(result.sha256, createHash('sha256').update(source).digest('hex'));
    await writeFile(
      info,
      `#!${process.execPath}\nconsole.log('MIME type: image/heic\\nimage: 100000x100000 (id=1), primary');`,
      { mode: 0o700 },
    );
    await assert.rejects(service.inspect('original.heic', 'image/heic'), /像素|pixel/);
    await writeFile(
      info,
      `#!${process.execPath}\nconsole.log('MIME type: image/jpeg\\nimage: 12x8 (id=1), primary');`,
      { mode: 0o700 },
    );
    await assert.rejects(service.inspect('original.heic', 'image/heic'), /格式|decode|解码/);
  } finally {
    if (oldInfo === undefined) delete process.env.HEIF_INFO_PATH;
    else process.env.HEIF_INFO_PATH = oldInfo;
    if (oldDecode === undefined) delete process.env.HEIF_CONVERT_PATH;
    else process.env.HEIF_CONVERT_PATH = oldDecode;
    await rm(dir, { recursive: true, force: true });
  }
});
