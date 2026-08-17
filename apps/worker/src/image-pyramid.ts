export const PYRAMID_TILE_SIZE = 512;
export const PYRAMID_TILE_OVERLAP = 1;

export function buildPyramidDescriptor(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('INVALID_PYRAMID_DIMENSIONS');
  }
  return {
    width,
    height,
    tileSize: PYRAMID_TILE_SIZE,
    overlap: PYRAMID_TILE_OVERLAP,
    format: 'webp' as const,
    maxLevel: Math.ceil(Math.log2(Math.max(width, height))),
  };
}

export function parseDeepZoomTilePath(relativePath: string) {
  const match = /^(0|[1-9]\d*)\/(0|[1-9]\d*)_(0|[1-9]\d*)\.webp$/.exec(relativePath);
  if (!match) throw new Error('INVALID_PYRAMID_TILE');
  const level = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (![level, x, y].every(Number.isSafeInteger)) throw new Error('INVALID_PYRAMID_TILE');
  return { level, x, y, relativeKey: `${level}/${x}_${y}.webp` };
}
