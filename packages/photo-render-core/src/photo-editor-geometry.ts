import { photoCrop, type PhotoEdits } from './photo-editor-model';
export function drawPhoto(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  edits: PhotoEdits,
  crop = true,
) {
  const region = photoCrop(source.width, source.height, edits);
  target.width = crop ? region.width : region.orientedWidth;
  target.height = crop ? region.height : region.orientedHeight;
  const context = target.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.save();
  context.translate(
    (crop ? -region.x : 0) + region.orientedWidth / 2,
    (crop ? -region.y : 0) + region.orientedHeight / 2,
  );
  if (edits.flip) context.scale(-1, 1);
  context.rotate((edits.rotation * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.restore();
}
