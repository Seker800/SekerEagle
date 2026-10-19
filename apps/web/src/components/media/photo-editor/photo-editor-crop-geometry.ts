import { photoCrop, type PhotoEdits } from './photo-editor-model';

export type CropHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Rect = { x: number; y: number; width: number; height: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Encode a bounded rectangle in oriented source pixels; preview and export use photoCrop. */
export function cropRectPatch(
  width: number,
  height: number,
  edits: PhotoEdits,
  rect: Rect,
): Partial<PhotoEdits> {
  const source = photoCrop(width, height, edits, false);
  const cropAspect = rect.width / rect.height;
  const base = photoCrop(width, height, { ...edits, cropAspect, cropZoom: 1 }, false);
  return {
    cropAspect: edits.cropRatio === 'free' ? cropAspect : edits.cropAspect,
    cropZoom: clamp(base.width / rect.width, 1, 16),
    cropX:
      source.orientedWidth > rect.width
        ? clamp(rect.x / (source.orientedWidth - rect.width), 0, 1)
        : 0.5,
    cropY:
      source.orientedHeight > rect.height
        ? clamp(rect.y / (source.orientedHeight - rect.height), 0, 1)
        : 0.5,
  };
}

/** Resize against an opposite corner/edge, enforcing either free bounds or the selected ratio. */
export function dragPhotoCrop(
  width: number,
  height: number,
  edits: PhotoEdits,
  handle: CropHandle,
  dx: number,
  dy: number,
  minimum = { width: 1, height: 1 },
): Partial<PhotoEdits> {
  const region = photoCrop(width, height, edits, false);
  const { orientedWidth: w, orientedHeight: h } = region;
  let { x, y, width: cw, height: ch } = region;
  if (handle === 'move') {
    return {
      cropX: w > cw ? clamp((x + dx) / (w - cw), 0, 1) : 0.5,
      cropY: h > ch ? clamp((y + dy) / (h - ch), 0, 1) : 0.5,
    };
  }
  const west = handle.includes('w'),
    east = handle.includes('e');
  const north = handle.includes('n'),
    south = handle.includes('s');
  const right = x + cw,
    bottom = y + ch;
  if (edits.cropRatio === 'free') {
    const minWidth = Math.min(cw, Math.max(w / 16, minimum.width));
    const minHeight = Math.min(ch, Math.max(h / 16, minimum.height));
    const left = west ? clamp(x + dx, 0, right - minWidth) : x;
    const top = north ? clamp(y + dy, 0, bottom - minHeight) : y;
    const r = east ? clamp(right + dx, left + minWidth, w) : right;
    const b = south ? clamp(bottom + dy, top + minHeight, h) : bottom;
    return cropRectPatch(width, height, edits, {
      x: left,
      y: top,
      width: r - left,
      height: b - top,
    });
  }
  const base = photoCrop(width, height, { ...edits, cropZoom: 1 }, false);
  const ratio = base.width / base.height;
  if ((west || east) && (north || south)) {
    const anchorX = west ? right : x,
      anchorY = north ? bottom : y;
    const maxWidth = Math.min(
      west ? anchorX : w - anchorX,
      (north ? anchorY : h - anchorY) * ratio,
    );
    const wanted =
      Math.abs(dx) / cw >= Math.abs(dy) / ch
        ? cw + (west ? -dx : dx)
        : (ch + (north ? -dy : dy)) * ratio;
    cw = clamp(
      wanted,
      Math.min(maxWidth, Math.max(base.width / 16, minimum.width, minimum.height * ratio)),
      maxWidth,
    );
    ch = cw / ratio;
    x = west ? anchorX - cw : anchorX;
    y = north ? anchorY - ch : anchorY;
  } else if (west || east) {
    const centerY = y + ch / 2,
      anchorX = west ? right : x;
    const maxWidth = Math.min(
      west ? anchorX : w - anchorX,
      2 * Math.min(centerY, h - centerY) * ratio,
    );
    cw = clamp(
      cw + (west ? -dx : dx),
      Math.min(maxWidth, Math.max(base.width / 16, minimum.width, minimum.height * ratio)),
      maxWidth,
    );
    ch = cw / ratio;
    x = west ? anchorX - cw : anchorX;
    y = centerY - ch / 2;
  } else {
    const centerX = x + cw / 2,
      anchorY = north ? bottom : y;
    const maxHeight = Math.min(
      north ? anchorY : h - anchorY,
      (2 * Math.min(centerX, w - centerX)) / ratio,
    );
    ch = clamp(
      ch + (north ? -dy : dy),
      Math.min(maxHeight, Math.max(base.height / 16, minimum.height, minimum.width / ratio)),
      maxHeight,
    );
    cw = ch * ratio;
    x = centerX - cw / 2;
    y = north ? anchorY - ch : anchorY;
  }
  return cropRectPatch(width, height, edits, { x, y, width: cw, height: ch });
}
