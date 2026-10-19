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
  website: string;
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
interface TextLine {
  value: string;
  size: number;
  family?: string;
  weight?: number;
  color?: string;
}

/** Fit a real content group inside its own rectangle, collapsing absent metadata. */
export function textBlock(
  d: WatermarkDrawing,
  lines: readonly TextLine[],
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    align?: CanvasTextAlign;
    vertical?: 'start' | 'center' | 'end';
  },
) {
  const visible = lines.filter((line) => line.value.trim());
  if (!visible.length || box.width <= 0 || box.height <= 0) return;
  const naturalHeight = visible.reduce((height, line) => height + line.size * 1.4, 0);
  const scale = Math.min(1, box.height / naturalHeight);
  const height = naturalHeight * scale;
  let y =
    box.y +
    (box.vertical === 'start'
      ? 0
      : box.vertical === 'end'
        ? box.height - height
        : (box.height - height) / 2);
  const align = box.align ?? 'left';
  const x = box.x + (align === 'center' ? box.width / 2 : align === 'right' ? box.width : 0);
  for (const line of visible) {
    const size = line.size * scale;
    label(d, line.value, x, y + size, size, box.width, align, line.weight, line.family, line.color);
    y += size * 1.4;
  }
}
