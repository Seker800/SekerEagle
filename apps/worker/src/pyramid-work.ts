import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { CAMERA_MAX_IMAGE_PIXELS } from '@sekereagle/library-core';
import { withProcessableImage } from './image-media';
import { buildPyramidDescriptor, parseDeepZoomTilePath } from './image-pyramid';

export type PyramidDescriptor = ReturnType<typeof buildPyramidDescriptor>;
export async function renderPyramidWork(
  source: AsyncIterable<Uint8Array>,
  mimeType: string,
  sourceName: string,
  directory: string,
) {
  const base = join(directory, 'pyramid');
  const tileDirectory = base + '_files';
  const { result: descriptor, sha256 } = await withProcessableImage(
    source,
    mimeType,
    sourceName,
    async (image) => {
      const metadata = await image.clone().metadata();
      const width = metadata.autoOrient.width ?? metadata.width;
      const height = metadata.autoOrient.height ?? metadata.height;
      if (!width || !height) throw new Error('INVALID_PYRAMID_DIMENSIONS');
      const descriptor = buildPyramidDescriptor(width, height);
      await image
        .rotate()
        .webp({ quality: 82 })
        .tile({ layout: 'dz', size: descriptor.tileSize, overlap: descriptor.overlap })
        .toFile(base + '.dz');
      return descriptor;
    },
  );
  const files: string[] = [];
  for (const level of await readdir(tileDirectory, { withFileTypes: true })) {
    if (!level.isDirectory()) continue;
    for (const file of await readdir(join(tileDirectory, level.name), { withFileTypes: true })) {
      if (!file.isFile()) throw new Error('INVALID_PYRAMID_TILE');
      files.push(parseDeepZoomTilePath(`${level.name}/${file.name}`).relativeKey);
    }
  }
  return { descriptor, sha256, tileDirectory, files };
}

export function validatePyramidDescriptor(input: unknown): PyramidDescriptor {
  const value = input as PyramidDescriptor;
  if (
    !value ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    value.width <= 0 ||
    value.height <= 0 ||
    value.width * value.height > CAMERA_MAX_IMAGE_PIXELS
  )
    throw new Error('INVALID_PYRAMID_RESULT');
  const expected = buildPyramidDescriptor(value.width, value.height);
  if (
    Object.keys(expected).some(
      (key) => value[key as keyof PyramidDescriptor] !== expected[key as keyof PyramidDescriptor],
    )
  )
    throw new Error('INVALID_PYRAMID_RESULT');
  return expected;
}

export function pyramidTileDimensions(descriptor: PyramidDescriptor, name: string) {
  const tile = parseDeepZoomTilePath(name);
  if (tile.level > descriptor.maxLevel) throw new Error('INVALID_PYRAMID_TILE');
  const scale = 2 ** (descriptor.maxLevel - tile.level);
  const width = Math.ceil(descriptor.width / scale),
    height = Math.ceil(descriptor.height / scale);
  const left = tile.x * descriptor.tileSize,
    top = tile.y * descriptor.tileSize;
  if (left >= width || top >= height) throw new Error('INVALID_PYRAMID_TILE');
  return {
    width:
      Math.min(width, left + descriptor.tileSize + descriptor.overlap) -
      Math.max(0, left - descriptor.overlap),
    height:
      Math.min(height, top + descriptor.tileSize + descriptor.overlap) -
      Math.max(0, top - descriptor.overlap),
  };
}

export async function validatePyramidArtifacts(
  descriptor: PyramidDescriptor,
  files: { name: string; path: string }[],
) {
  validatePyramidDescriptor(descriptor);
  let expectedCount = 0;
  for (let level = 0; level <= descriptor.maxLevel; level++) {
    const scale = 2 ** (descriptor.maxLevel - level);
    expectedCount +=
      Math.ceil(Math.ceil(descriptor.width / scale) / descriptor.tileSize) *
      Math.ceil(Math.ceil(descriptor.height / scale) / descriptor.tileSize);
  }
  if (files.length !== expectedCount || new Set(files.map((x) => x.name)).size !== files.length)
    throw new Error('INCOMPLETE_PYRAMID');
  for (const file of files) {
    const dimensions = pyramidTileDimensions(descriptor, file.name);
    const actual = await sharp(file.path, { limitInputPixels: 514 * 514 }).metadata();
    if (
      actual.format !== 'webp' ||
      actual.width !== dimensions.width ||
      actual.height !== dimensions.height
    )
      throw new Error('INVALID_PYRAMID_TILE');
  }
}
