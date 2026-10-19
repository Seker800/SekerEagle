import { label, paragraph, rule, type WatermarkDrawing } from './photo-watermark-drawing';
import { watermarkAlignment, type WatermarkStyle } from './photo-watermark-model';

type Painter = (drawing: WatermarkDrawing) => void;
const mono = 'ui-monospace, monospace';
const serif = 'Georgia, serif';
const painters: Record<WatermarkStyle, Painter> = {
  strip(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      padding = l.photoWidth * 0.035;
    const align = watermarkAlignment(d.edits.watermark, d.edits.watermarkAlign);
    const x =
      align === 'left'
        ? p.x + padding
        : align === 'right'
          ? p.x + p.width - padding
          : p.x + p.width / 2;
    label(d, d.title, x, p.y + p.height * 0.44, s, p.width - padding * 2, align, 600);
    label(
      d,
      [d.details, d.time].filter(Boolean).join('  ·  '),
      x,
      p.y + p.height * 0.7,
      s * 0.45,
      p.width - padding * 2,
      align,
      400,
      undefined,
      d.secondary,
    );
  },
  editorial(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      pad = l.photoWidth * 0.055,
      x = p.x + pad,
      w = p.width - pad * 1.65;
    rule(d, x, p.y + s * 0.5, x + w, p.y + s * 0.5, d.foreground);
    paragraph(d, d.title, x, p.y + s * 2, w, s * 1.15, 3);
    const fields = d.details.split(/\s*[·|]\s*/).filter(Boolean);
    let y = p.y + Math.max(s * 7, p.height * 0.48);
    for (const field of fields.slice(0, 5)) {
      if (y > p.y + p.height - s * 2.5) break;
      label(d, field, x, y, s * 0.52, w, 'left', 400, mono, d.secondary);
      y += s * 1.15;
    }
    label(
      d,
      d.camera === d.title ? '' : d.camera,
      x,
      p.y + p.height - s * 1.5,
      s * 0.5,
      w,
      'left',
      500,
    );
    label(d, d.time, x, p.y + p.height - s * 0.4, s * 0.43, w, 'left', 400, undefined, d.secondary);
  },
  overlay(d) {
    const { layout: l, size: s } = d,
      align = watermarkAlignment(d.edits.watermark, d.edits.watermarkAlign);
    const pad = l.photoWidth * 0.045,
      x = align === 'left' ? pad : align === 'right' ? l.width - pad : l.width / 2;
    const y = l.height - Math.max(s * 0.9, l.photoHeight * 0.055);
    const detail = [d.details, d.time].filter(Boolean).join('  ·  ');
    label(d, d.title, x, y - (detail ? s * 0.9 : 0), s, l.width - pad * 2, align, 500);
    label(d, detail, x, y, s * 0.45, l.width - pad * 2, align, 400, undefined, d.secondary);
  },
  gallery(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      x = l.width / 2,
      y = p.y + p.height * 0.43;
    rule(d, x - s * 0.65, y - s * 1.55, x + s * 0.65, y - s * 1.55, d.secondary, 0.8);
    label(d, d.title, x, y, s * 0.88, l.photoWidth * 0.84, 'center', 400, serif);
    label(
      d,
      [d.camera === d.title ? '' : d.camera, d.details].filter(Boolean).join(' · '),
      x,
      y + s * 1.05,
      s * 0.4,
      l.photoWidth * 0.84,
      'center',
      400,
      undefined,
      d.secondary,
    );
    label(
      d,
      d.time,
      x,
      y + s * 1.9,
      s * 0.36,
      l.photoWidth * 0.84,
      'center',
      400,
      undefined,
      d.secondary,
    );
  },
  instant(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      pad = l.photoWidth * 0.035;
    label(
      d,
      d.title,
      p.x + pad,
      p.y + p.height * 0.42,
      s * 1.28,
      p.width - pad * 2,
      'left',
      400,
      serif,
    );
    label(
      d,
      d.time,
      p.x + pad,
      p.y + p.height * 0.72,
      s * 0.43,
      p.width - pad * 2,
      'left',
      400,
      mono,
      d.secondary,
    );
    label(
      d,
      d.details,
      p.x + pad,
      p.y + p.height * 0.88,
      s * 0.36,
      p.width - pad * 2,
      'left',
      400,
      undefined,
      d.secondary,
    );
  },
  film(d) {
    const { layout: l, size: s } = d,
      c = d.context,
      w = l.photoWidth;
    c.fillStyle = '#e4d7b9';
    const slotW = Math.max(1, w * 0.022),
      slotH = Math.max(1, w * 0.018),
      step = Math.max(2, w * 0.057);
    for (let x = l.x; x + slotW <= l.width - l.x; x += step) {
      c.fillRect(x, Math.max(0, l.y * 0.27), slotW, slotH);
      c.fillRect(x, l.height - slotH * 1.55, slotW, slotH);
    }
    label(d, d.title, l.x, l.y + l.photoHeight + s * 1.35, s * 0.63, w * 0.52, 'left', 500, mono);
    label(
      d,
      [d.details, d.time].filter(Boolean).join(' | '),
      l.x + w,
      l.y + l.photoHeight + s * 1.35,
      s * 0.37,
      w * 0.44,
      'right',
      400,
      mono,
      d.secondary,
    );
  },
  cinema(d) {
    const { layout: l, size: s } = d,
      w = l.photoWidth,
      pad = w * 0.045;
    label(d, d.title, pad, l.y * 0.62, s * 1.13, w * 0.65, 'left', 500);
    label(
      d,
      d.time,
      l.width - pad,
      l.y * 0.62,
      s * 0.37,
      w * 0.28,
      'right',
      400,
      mono,
      d.secondary,
    );
    const y = l.y + l.photoHeight + l.panel.height * 0.55;
    label(
      d,
      d.camera === d.title ? '' : d.camera,
      pad,
      y - s * 0.25,
      s * 0.52,
      w * 0.65,
      'left',
      600,
    );
    label(d, d.details, pad, y + s * 0.65, s * 0.43, w * 0.72, 'left', 400, mono, d.secondary);
    label(
      d,
      `${(l.photoWidth / l.photoHeight).toFixed(2)}:1`,
      l.width - pad,
      y + s * 0.65,
      s * 0.45,
      w * 0.18,
      'right',
      400,
      mono,
      d.secondary,
    );
  },
  postcard(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      pad = l.photoWidth * 0.055,
      x = p.x + pad,
      w = p.width - pad * 2;
    rule(d, p.x + pad * 0.4, p.y, p.x + pad * 0.4, p.y + p.height, d.secondary, 0.7);
    const stamp = Math.min(w * 0.3, l.photoWidth * 0.12),
      stampX = x + w - stamp;
    d.context.strokeStyle = d.secondary;
    d.context.lineWidth = Math.max(0.5, s * 0.025);
    d.context.strokeRect(stampX, p.y, stamp, stamp * 1.18);
    label(
      d,
      d.camera,
      stampX + stamp / 2,
      p.y + stamp * 0.58,
      s * 0.27,
      stamp * 0.86,
      'center',
      400,
      mono,
      d.secondary,
    );
    const messageY = p.y + Math.max(stamp * 1.65, p.height * 0.3);
    paragraph(d, d.title, x, messageY, w, s * 0.8, 4, serif);
    const bottom = p.y + p.height;
    rule(d, x, bottom - s * 2.5, x + w, bottom - s * 2.5, d.secondary, 0.5);
    label(d, d.details, x, bottom - s * 1.55, s * 0.36, w, 'left', 400, undefined, d.secondary);
    label(d, d.time, x, bottom - s * 0.4, s * 0.4, w, 'left', 400, mono, d.secondary);
  },
  blueprint(d) {
    const { layout: l, size: s } = d,
      c = d.context,
      step = Math.max(4, l.photoWidth * 0.035);
    c.save();
    c.beginPath();
    c.rect(0, 0, l.width, l.height);
    c.rect(l.x, l.y, l.photoWidth, l.photoHeight);
    c.clip('evenodd');
    for (let x = 0; x < l.width; x += step) rule(d, x, 0, x, l.height, '#19384a', 0.5);
    for (let y = 0; y < l.height; y += step) rule(d, 0, y, l.width, y, '#19384a', 0.5);
    c.restore();
    const top = l.y * 0.48,
      left = l.x * 0.45;
    rule(d, l.x, top, l.x + l.photoWidth, top, '#6496aa', 0.7);
    rule(d, left, l.y, left, l.y + l.photoHeight, '#6496aa', 0.7);
    for (const x of [l.x, l.x + l.photoWidth]) rule(d, x, top - 3, x, top + 3, '#a7dce6', 1);
    for (const y of [l.y, l.y + l.photoHeight]) rule(d, left - 3, y, left + 3, y, '#a7dce6', 1);
    label(
      d,
      `${l.photoWidth} × ${l.photoHeight}`,
      l.width - l.x,
      top - s * 0.2,
      s * 0.4,
      l.photoWidth * 0.38,
      'right',
      400,
      mono,
    );
    label(d, d.title, l.x, l.height - l.y * 0.4, s * 0.57, l.photoWidth * 0.48, 'left', 500, mono);
    label(
      d,
      [d.details, d.time].filter(Boolean).join(' · '),
      l.width - l.x,
      l.height - l.y * 0.4,
      s * 0.32,
      l.photoWidth * 0.48,
      'right',
      400,
      mono,
      d.secondary,
    );
  },
};
export function paintWatermark(drawing: WatermarkDrawing) {
  painters[drawing.template.style](drawing);
}
