import type { PhotoEdits } from './photo-editor-model';
import type {
  PhotoMetadata,
  WatermarkTemplate,
  photoWatermarkLayout,
} from './photo-watermark-model';

export interface WatermarkDrawing {
  context: CanvasRenderingContext2D;
  layout: ReturnType<typeof photoWatermarkLayout>;
  template: WatermarkTemplate;
  edits: PhotoEdits;
  metadata: PhotoMetadata;
  title: string;
  camera: string;
  details: string;
  time: string;
  foreground: string;
  secondary: string;
  size: number;
}

/** Flat text only: no shadow, text outline, filter, gradient or simulated depth. */
export function label(
  d: WatermarkDrawing,
  value: string,
  x: number,
  y: number,
  size: number,
  width: number,
  align: CanvasTextAlign = 'left',
  weight = 400,
  family = 'system-ui, sans-serif',
  color = d.foreground,
) {
  if (!value || width <= 0) return;
  const context = d.context;
  context.font = `${weight} ${Math.max(0.5, size)}px ${family}`;
  context.textAlign = align;
  context.textBaseline = 'alphabetic';
  context.fillStyle = color;
  const characters = Array.from(value.replace(/\s+/g, ' ').slice(0, 200));
  if (context.measureText(characters.join('')).width > width) {
    while (characters.length && context.measureText(`${characters.join('')}…`).width > width)
      characters.pop();
    if (characters.length) characters.push('…');
  }
  context.fillText(characters.join(''), x, y);
}
export function rule(
  d: WatermarkDrawing,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = d.secondary,
  thickness = 1,
) {
  const c = d.context;
  c.strokeStyle = color;
  c.lineWidth = Math.max(0.5, thickness);
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}
export function paragraph(
  d: WatermarkDrawing,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  lines: number,
  family = 'system-ui, sans-serif',
) {
  const c = d.context;
  c.font = `400 ${Math.max(0.5, size)}px ${family}`;
  const chars = Array.from(value.slice(0, 200));
  let line = '',
    lineIndex = 0;
  for (let i = 0; i < chars.length; i++) {
    const next = line + chars[i];
    if (c.measureText(next).width > width && line) {
      label(
        d,
        lineIndex === lines - 1 ? line + chars.slice(i).join('') : line,
        x,
        y + lineIndex * size * 1.5,
        size,
        width,
        'left',
        400,
        family,
      );
      if (++lineIndex >= lines) return;
      line = chars[i];
    } else line = next;
  }
  if (line) label(d, line, x, y + lineIndex * size * 1.5, size, width, 'left', 400, family);
}
