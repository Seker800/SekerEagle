import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, stat, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadCachedImage } from './cached-image';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cached-image-test-'));
  const original = join(root, 'latest.jpg');
  await writeFile(original, 'source original bytes remain untouched');
  const facts = await stat(original, { bigint: true });
  const directory = join(root, '@eaDir/latest.jpg');
  await mkdir(directory, { recursive: true });
  const preview = await sharp({ create: { width: 96, height: 64, channels: 3, background: 'red' } }).jpeg().toBuffer();
  for (const size of ['SM', 'M', 'XL']) await writeFile(join(directory, `SYNOPHOTO_THUMB_${size}.jpg`), preview);
  const item = { path: 'latest.jpg', size: facts.size.toString(), mtimeNs: facts.mtimeNs.toString(), inode: facts.ino.toString(), device: facts.dev.toString() };
  return { root, item, preview, original, directory };
}

test('copies JPEG bytes without re-encoding, reports actual dimensions and preserves source', async () => {
  const f = await fixture();
  try {
    const result = await loadCachedImage(f.root, f.item);
    assert.equal(result.originalPath, await realpath(f.original));
    assert.equal(result.renditions.length, 3);
    for (const rendition of result.renditions) {
      assert.deepEqual(rendition.data, f.preview);
      assert.equal(rendition.width, 96);
      assert.equal(rendition.height, 64);
      assert.equal(rendition.mimeType, 'image/jpeg');
    }
  } finally { await rm(f.root, { recursive: true }); }
});

test('rejects traversal, symlinks, changed source and stale or broken cache', async () => {
  const f = await fixture();
  try {
    for (const path of ['../latest.jpg', '/latest.jpg', 'a/../latest.jpg', 'a//latest.jpg'])
      await assert.rejects(loadCachedImage(f.root, { ...f.item, path }), /SOURCE_PATH/);
    await assert.rejects(loadCachedImage(f.root, { ...f.item, inode: '0' }), /SOURCE_CHANGED/);
    const sm = join(f.directory, 'SYNOPHOTO_THUMB_SM.jpg');
    await rm(sm); await symlink(f.original, sm);
    await assert.rejects(loadCachedImage(f.root, f.item), /CACHE_PATH/);
    await rm(sm); await writeFile(sm, 'not a JPEG');
    await assert.rejects(loadCachedImage(f.root, f.item), /CACHE_INVALID/);
  } finally { await rm(f.root, { recursive: true }); }
});

test('rejects a cache with unapplied orientation or incompatible aspect ratio', async () => {
  const f = await fixture();
  try {
    const sm = join(f.directory, 'SYNOPHOTO_THUMB_SM.jpg');
    await writeFile(sm, await sharp(f.preview).withMetadata({ orientation: 6 }).jpeg().toBuffer());
    await assert.rejects(loadCachedImage(f.root, f.item), /CACHE_ORIENTATION/);
    await writeFile(sm, await sharp(f.preview).resize(64, 96).jpeg().toBuffer());
    await assert.rejects(loadCachedImage(f.root, f.item), /CACHE_ASPECT/);
  } finally { await rm(f.root, { recursive: true }); }
});
