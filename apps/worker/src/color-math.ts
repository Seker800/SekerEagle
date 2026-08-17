export interface LabColor {
  labL: number;
  labA: number;
  labB: number;
}

export function rgbToLab(red: number, green: number, blue: number): LabColor {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0]! * 0.4124 + linear[1]! * 0.3576 + linear[2]! * 0.1805) / 0.95047;
  const y = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  const z = (linear[0]! * 0.0193 + linear[1]! * 0.1192 + linear[2]! * 0.9505) / 1.08883;
  const transform = (component: number) =>
    component > 0.008856 ? Math.cbrt(component) : 7.787 * component + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return { labL: 116 * fy - 16, labA: 500 * (fx - fy), labB: 200 * (fy - fz) };
}

export function colorDistance(left: LabColor, right: LabColor): number {
  return Math.hypot(left.labL - right.labL, left.labA - right.labA, left.labB - right.labB);
}
