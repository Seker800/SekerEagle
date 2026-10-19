import { label, paragraph, rule, type WatermarkDrawing } from './photo-watermark-drawing';
import { watermarkAlignment, type WatermarkStyle } from './photo-watermark-model';

type Painter = (drawing: WatermarkDrawing) => void;
const font = 'system-ui, sans-serif';
/** Each painter corresponds to a different information structure in sekerwatermark references. */
const painters: Record<WatermarkStyle, Painter> = {
  strip(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      pad = l.photoWidth * 0.04,
      y = p.y + p.height * 0.48;
    label(d, d.title, p.x + pad, y, s * 0.9, p.width * 0.44, 'left', 600);
    label(
      d,
      d.camera === d.title ? '' : d.camera,
      p.x + pad,
      y + s * 0.8,
      s * 0.43,
      p.width * 0.44,
      'left',
      400,
      font,
      d.secondary,
    );
    label(d, d.details, p.x + p.width - pad, y, s * 0.52, p.width * 0.46, 'right', 500);
    label(
      d,
      d.time,
      p.x + p.width - pad,
      y + s * 0.8,
      s * 0.43,
      p.width * 0.46,
      'right',
      400,
      font,
      d.secondary,
    );
  },
  side(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      c = d.context;
    c.save();
    c.translate(p.x + p.width * 0.55, p.y + p.height / 2);
    c.rotate(Math.PI / 2);
    label(
      d,
      [d.title, d.details, d.time].filter(Boolean).join('   |   '),
      0,
      0,
      Math.min(s * 0.6, p.width * 0.24),
      p.height * 0.86,
      'center',
      500,
    );
    c.restore();
  },
  overlay(d) {
    const { layout: l, size: s } = d,
      align = watermarkAlignment(d.edits.watermark, d.edits.watermarkAlign);
    const pad = l.photoWidth * 0.045,
      x = align === 'left' ? pad : align === 'right' ? l.width - pad : l.width / 2;
    const y = l.height - Math.max(s * 0.9, l.photoHeight * 0.055);
    label(d, d.title, x, y - s * 0.9, s, l.width - pad * 2, align, 500);
    label(d, d.details, x, y, s * 0.45, l.width - pad * 2, align, 400, font, d.secondary);
    if (align !== 'right')
      label(d, d.time, l.width - pad, y, s * 0.45, l.width * 0.25, 'right', 400, font, d.secondary);
  },
  cornerGrid(d) {
    const { layout: l, size: s } = d,
      pad = l.photoWidth * 0.04,
      top = pad + s * 0.55,
      bottom = l.height - pad;
    label(d, d.camera || d.title, pad, top, s * 0.72, l.width * 0.56, 'left', 600);
    label(
      d,
      d.title === d.camera ? '' : d.title,
      pad,
      bottom - s * 0.9,
      s * 0.6,
      l.width * 0.43,
      'left',
      500,
    );
    label(d, d.time, pad, bottom, s * 0.43, l.width * 0.43, 'left', 400, font, d.secondary);
    const fields = d.details.split(/\s*[·|]\s*/).filter(Boolean);
    fields.slice(0, 4).forEach((field, index) => {
      const col = index % 2,
        row = Math.floor(index / 2),
        x = l.width - pad - (1 - col) * l.width * 0.17;
      label(d, field, x, bottom - (1 - row) * s * 1.05, s * 0.49, l.width * 0.16, 'right', 500);
    });
  },
  colorBlock(d) {
    const { layout: l, size: s } = d,
      c = d.context,
      pad = l.photoWidth * 0.04,
      w = l.width - pad * 2;
    const h = Math.min(l.photoWidth * 0.105, l.photoHeight * 0.22),
      x = pad,
      y = l.height - pad - h,
      split = w * 0.34,
      fs = Math.min(s, h * 0.31);
    c.save();
    c.globalAlpha = 1;
    c.fillStyle = '#c73531';
    c.fillRect(x, y, split, h);
    c.fillStyle = '#ffffff';
    c.fillRect(x + split, y, w - split, h);
    c.restore();
    label(
      d,
      d.title,
      x + split * 0.08,
      y + h * 0.59,
      fs * 0.82,
      split * 0.84,
      'left',
      600,
      font,
      '#ffffff',
    );
    label(
      d,
      d.details,
      x + w - w * 0.025,
      y + h * 0.43,
      fs * 0.6,
      (w - split) * 0.92,
      'right',
      600,
      font,
      '#202020',
    );
    label(
      d,
      d.time,
      x + w - w * 0.025,
      y + h * 0.74,
      fs * 0.5,
      (w - split) * 0.92,
      'right',
      400,
      font,
      '#777777',
    );
  },
  frame(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      x = l.width / 2,
      y = p.y + p.height * 0.43;
    label(d, d.title, x, y, s * 0.95, l.photoWidth * 0.88, 'center', 600);
    label(
      d,
      [d.camera === d.title ? '' : d.camera, d.details].filter(Boolean).join(' · '),
      x,
      y + s * 0.95,
      s * 0.44,
      l.photoWidth * 0.88,
      'center',
      400,
      font,
      d.secondary,
    );
    label(
      d,
      d.time,
      x,
      y + s * 1.8,
      s * 0.38,
      l.photoWidth * 0.88,
      'center',
      400,
      font,
      d.secondary,
    );
  },
  headerFooter(d) {
    const { layout: l, size: s } = d,
      pad = l.photoWidth * 0.045,
      top = l.y * 0.61,
      bottom = l.y + l.photoHeight + l.panel.height * 0.48;
    label(d, d.camera || d.title, l.x + pad, top, s * 0.64, l.photoWidth * 0.55, 'left', 600);
    label(
      d,
      d.time,
      l.x + l.photoWidth - pad,
      top,
      s * 0.42,
      l.photoWidth * 0.32,
      'right',
      400,
      font,
      d.secondary,
    );
    label(
      d,
      d.title === d.camera ? '' : d.title,
      l.x + pad,
      bottom,
      s * 0.86,
      l.photoWidth * 0.43,
      'left',
      500,
    );
    const parts = d.details.split(/\s*[·|]\s*/).filter(Boolean);
    label(
      d,
      parts[0] || '',
      l.x + l.photoWidth - pad,
      bottom - s * 0.2,
      s * 0.6,
      l.photoWidth * 0.42,
      'right',
      600,
    );
    label(
      d,
      parts.slice(1).join('  ·  '),
      l.x + l.photoWidth - pad,
      bottom + s * 0.7,
      s * 0.45,
      l.photoWidth * 0.42,
      'right',
      400,
      font,
      d.secondary,
    );
  },
  editorial(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      pad = l.photoWidth * 0.05,
      x = p.x + pad,
      w = p.width - pad * 1.7;
    paragraph(d, d.title, x, p.y + p.height * 0.28, w, s * 1.05, 3);
    rule(d, x, p.y + p.height * 0.52, x + w * 0.4, p.y + p.height * 0.52, d.secondary, 0.75);
    label(
      d,
      d.camera === d.title ? '' : d.camera,
      x,
      p.y + p.height * 0.65,
      s * 0.52,
      w,
      'left',
      600,
    );
    const fields = d.details.split(/\s*[·|]\s*/).filter(Boolean);
    fields
      .slice(0, 4)
      .forEach((field, index) =>
        label(
          d,
          field,
          x,
          p.y + p.height * 0.72 + index * s * 0.8,
          s * 0.43,
          w,
          'left',
          400,
          font,
          d.secondary,
        ),
      );
    label(d, d.time, x, p.y + p.height - s * 0.4, s * 0.38, w, 'left', 400, font, d.secondary);
  },
};
export function paintWatermark(drawing: WatermarkDrawing) {
  painters[drawing.template.style](drawing);
}
