import type { PhotoEdits } from './photo-editor-model';
import type { PhotoMetadata } from './photo-watermark-model';

const GEOMETRY_KEYS = new Set([
  'cropRatio',
  'cropZoom',
  'cropAspect',
  'cropX',
  'cropY',
  'rotation',
  'straighten',
  'flip',
]);

/** Pixels after tone and filter processing; geometry only matters for grain and vignette. */
export function photoProcessedKey(edits: PhotoEdits): string {
  return JSON.stringify(
    Object.entries(edits).filter(
      ([key]) =>
        !key.startsWith('watermark') &&
        !(!edits.grain && !edits.vignette && GEOMETRY_KEYS.has(key)),
    ),
  );
}

/**
 * What the preview canvas must rasterize. The crop workspace shows the full frame
 * and applies rotation, flip and straighten as CSS transforms, so its bitmap only
 * follows processed pixels and comparison; when grain or vignette are on the
 * processed key already carries the geometry they are anchored to.
 */
export function photoPreviewKey(
  edits: PhotoEdits,
  view: { compare: boolean; tab: string; metadata: PhotoMetadata },
): string {
  const processed = photoProcessedKey(edits);
  if (view.tab === 'crop') return JSON.stringify([processed, view.compare]);
  return JSON.stringify([processed, edits, view.compare, view.tab, view.metadata]);
}
