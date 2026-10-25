import { label, textBlock, rule, type WatermarkDrawing } from './photo-watermark-drawing';
import { watermarkAlignment, type WatermarkStyle } from './photo-watermark-model';

type Painter = (drawing: WatermarkDrawing) => void;
const fields = (d: WatermarkDrawing) => d.details.split(/\s*[·|]\s*/).filter(Boolean);
const secondary = (d: WatermarkDrawing, value: string, size = d.size * 0.58) => ({
  value,
  size,
  color: d.secondary,
});
const heading = (d: WatermarkDrawing, value = d.camera, size = d.size * 0.9) => ({
  value,
  size,
});

const website = (d: WatermarkDrawing) => secondary(d, d.website, d.size * 0.44);

/** Layouts share a type scale; empty lines collapse instead of leaving placeholder gaps. */
const painters: Record<WatermarkStyle, Painter> = {
  strip(d) {
    const { layout: l, size: s } = d,
      p = l.panel,
      pad = l.referenceWidth * 0.04;
    textBlock(d, [heading(d), website(d)], {
      x: pad,
      y: p.y,
      width: p.width * 0.43,
      height: p.height,
    });
    textBlock(d, [{ value: d.details, size: s * 0.62 }, secondary(d, d.time, s * 0.5)], {
      x: p.width * 0.5,
      y: p.y,
      width: p.width * 0.5 - pad,
      height: p.height,
      align: 'right',
    });
  },
  side(d) {
    const { layout: l, size: s, context: c } = d,
      p = l.panel;
    // A portrait rail keeps all typography off the photo, with two independent groups.
    c.save();
    c.translate(p.x + p.width / 2, p.height / 2);
    c.rotate(-Math.PI / 2);
    const railWidth = p.height * 0.88,
      railHeight = p.width * 0.8;
    textBlock(d, [heading(d, d.camera, s * 0.78)], {
      x: -railWidth / 2,
      y: -railHeight / 2,
      width: railWidth * 0.42,
      height: railHeight,
    });
    textBlock(
      d,
      [
        { value: fields(d).join('  /  '), size: s * 0.6 },
        secondary(d, d.time, s * 0.48),
        website(d),
      ],
      { x: 0, y: -railHeight / 2, width: railWidth / 2, height: railHeight, align: 'right' },
    );
    c.restore();
  },
  overlay(d) {
    const { layout: l, size: s } = d;
    const align = watermarkAlignment(d.edits.watermark, d.edits.watermarkAlign);
    const pad = Math.min(l.referenceWidth * 0.045, l.photoHeight * 0.1);
    const height = Math.min(s * 5, l.height - pad * 2);
    textBlock(
      d,
      [
        { value: d.camera, size: s },
        secondary(d, d.details, s * 0.58),
        secondary(d, d.time, s * 0.48),
        website(d),
      ],
      {
        x: pad,
        y: l.height - pad - height,
        width: l.width - pad * 2,
        height,
        align,
        vertical: 'end',
      },
    );
  },
  cornerGrid(d) {
    const { layout: l, size: s } = d;
    const pad = Math.min(l.referenceWidth * 0.04, l.photoHeight * 0.08);
    label(d, d.camera, pad, pad + s * 0.72, s * 0.72, l.width - pad * 2, 'left');
    const height = Math.min(s * 3.5, l.height * 0.34);
    textBlock(d, [secondary(d, d.time, s * 0.53), website(d)], {
      x: pad,
      y: l.height - pad - height,
      width: l.width * 0.45 - pad,
      height,
      vertical: 'end',
    });
    const parts = fields(d);
    textBlock(
      d,
      [
        { value: parts.slice(0, 2).join('  /  '), size: s * 0.6 },
        { value: parts.slice(2).join('  /  '), size: s * 0.54, color: d.secondary },
      ],
      {
        x: l.width * 0.5,
        y: l.height - pad - height,
        width: l.width * 0.5 - pad,
        height,
        align: 'right',
        vertical: 'end',
      },
    );
  },
  colorBlock(d) {
    const { layout: l, size: s, context: c } = d;
    const pad = Math.min(l.referenceWidth * 0.04, l.photoHeight * 0.06);
    const w = l.width - pad * 2,
      h = Math.min(l.referenceWidth * 0.082, l.photoHeight * 0.25);
    const x = pad,
      y = l.height - pad - h,
      split = w * 0.3;
    c.save();
    c.globalAlpha = 1;
    c.fillStyle = '#b9342e';
    c.fillRect(x, y, split, h);
    c.fillStyle = '#ffffff';
    c.fillRect(x + split, y, w - split, h);
    c.restore();
    textBlock(
      d,
      [
        { value: d.camera, size: s * 0.76, color: '#ffffff' },
        { ...website(d), color: '#ffffff' },
      ],
      {
        x: x + w * 0.025,
        y,
        width: split - w * 0.05,
        height: h,
      },
    );
    textBlock(
      d,
      [
        { value: d.details, size: s * 0.56, color: '#000000' },
        { value: d.time, size: s * 0.46, color: '#000000' },
      ],
      { x: x + split + w * 0.025, y, width: w - split - w * 0.05, height: h, align: 'right' },
    );
  },
  frame(d) {
    const { layout: l, size: s } = d,
      p = l.panel;
    textBlock(
      d,
      [
        { value: d.camera, size: s * 1.05 },
        secondary(d, d.details),
        secondary(d, d.time, s * 0.48),
        website(d),
      ],
      {
        x: l.x + l.photoWidth * 0.06,
        y: p.y,
        width: l.photoWidth * 0.88,
        height: p.height - l.y * 0.35,
        align: 'center',
      },
    );
  },
  headerFooter(d) {
    const { layout: l, size: s } = d,
      pad = l.referenceWidth * 0.04;
    const x = l.x + pad,
      width = l.photoWidth - pad * 2;
    textBlock(d, [heading(d, d.camera, s * 0.65)], {
      x,
      y: 0,
      width: width * 0.6,
      height: l.y,
    });
    textBlock(d, [secondary(d, d.time, s * 0.52)], {
      x: x + width * 0.62,
      y: 0,
      width: width * 0.38,
      height: l.y,
      align: 'right',
    });
    const parts = fields(d);
    textBlock(d, [website(d)], {
      x,
      y: l.panel.y,
      width: width * 0.42,
      height: l.panel.height,
    });
    textBlock(
      d,
      [
        { value: parts[0] || '', size: s * 0.75 },
        { value: parts.slice(1).join('  /  '), size: s * 0.56, color: d.secondary },
      ],
      {
        x: x + width * 0.46,
        y: l.panel.y,
        width: width * 0.54,
        height: l.panel.height,
        align: 'right',
      },
    );
  },
  editorial(d) {
    const { layout: l, size: s } = d,
      p = l.panel;
    const pad = l.referenceWidth * 0.035,
      x = p.x + pad,
      width = p.width - pad * 2;
    const titleHeight = Math.min(s * 4, p.height * 0.4);
    textBlock(d, [{ value: d.camera, size: s * 0.92 }], {
      x,
      y: p.y + pad,
      width,
      height: titleHeight,
      vertical: 'start',
    });
    const bottomHeight = Math.min(p.height * 0.48, s * 7);
    const bottom = p.y + p.height - pad;
    rule(
      d,
      x,
      bottom - bottomHeight,
      x + width,
      bottom - bottomHeight,
      d.secondary,
      l.referenceWidth * 0.0005,
    );
    textBlock(
      d,
      [
        ...fields(d).map((value) => ({ value, size: s * 0.56 })),
        secondary(d, d.time, s * 0.48),
        website(d),
      ],
      {
        x,
        y: bottom - bottomHeight + s * 0.5,
        width,
        height: bottomHeight - s * 0.5,
        vertical: 'end',
      },
    );
  },
};
export function paintWatermark(drawing: WatermarkDrawing) {
  painters[drawing.template.style](drawing);
}
