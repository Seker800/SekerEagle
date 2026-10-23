import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { dirname, basename, join, resolve, sep } from 'node:path';
import sharp from 'sharp';

export interface CachedImageSource {
  path: string;
  size: string;
  mtimeNs: string;
  inode: string;
  device: string;
}
export interface CachedImageRendition {
  kind: 'THUMBNAIL' | 'PREVIEW';
  variant: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  data: Buffer;
}

/** A frozen import source is read-only input, never a live gallery dependency. */
export async function verifyCachedImageSource(root: string, item: CachedImageSource) {
  if (!item.path || item.path.split('/').some((part) => !part || part === '.' || part === '..'))
    throw new Error('SOURCE_PATH');
  const directory = await realpath(root);
  const path = resolve(directory, item.path);
  if (!path.startsWith(directory + sep) || (await realpath(path)) !== path)
    throw new Error('SOURCE_PATH');
  const facts = await stat(path, { bigint: true });
  if (!facts.isFile() || facts.size.toString() !== item.size || facts.mtimeNs.toString() !== item.mtimeNs || facts.ino.toString() !== item.inode || facts.dev.toString() !== item.device)
    throw new Error('SOURCE_CHANGED');
  return path;
}

/** Reuse the JPEG bytes and real dimensions; do not re-encode or pretend M is 512px. */
export async function loadCachedImage(root: string, item: CachedImageSource) {
  const originalPath = await verifyCachedImageSource(root, item);
  const directory = join(dirname(originalPath), '@eaDir', basename(originalPath));
  const renditions: CachedImageRendition[] = [];
  const specs = [
    ['SM', 'THUMBNAIL', '256'], ['M', 'THUMBNAIL', '512'], ['XL', 'PREVIEW', 'default'],
  ] as const;
  for (const [size, kind, variant] of specs) {
    const path = join(directory, `SYNOPHOTO_THUMB_${size}.jpg`);
    if ((await realpath(path)) !== path) throw new Error('CACHE_PATH');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const facts = await file.stat({ bigint: true });
      if (!facts.isFile() || facts.size < 4n || facts.size > 16n * 1024n * 1024n)
        throw new Error('CACHE_SIZE');
      if (facts.mtimeNs < BigInt(item.mtimeNs)) throw new Error('CACHE_STALE');
      const data = await file.readFile();
      const image = sharp(data, { failOn: 'warning', limitInputPixels: 40_000_000 });
      const metadata = await image.metadata().catch(() => { throw new Error('CACHE_INVALID'); });
      if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height)
        throw new Error('CACHE_INVALID');
      if (metadata.orientation && metadata.orientation !== 1) throw new Error('CACHE_ORIENTATION');
      await image.resize(1, 1).raw().toBuffer().catch(() => { throw new Error('CACHE_INVALID'); });
      renditions.push({ kind, variant, mimeType: 'image/jpeg', width: metadata.width, height: metadata.height, data });
    } finally { await file.close(); }
  }
  const aspect = renditions[2]!.width / renditions[2]!.height;
  if (renditions.some((value) => Math.abs((value.width / value.height) / aspect - 1) > 0.02))
    throw new Error('CACHE_ASPECT');
  await verifyCachedImageSource(root, item);
  return { originalPath, renditions };
}
