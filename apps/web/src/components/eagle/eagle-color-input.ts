const COLOR_INPUT_ERROR = '请输入 HEX、RGB 或 HSL 颜色';

function channelToHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

function rgbToHex(red: number, green: number, blue: number): string {
  if (![red, green, blue].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
    throw new Error(COLOR_INPUT_ERROR);
  }
  return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (
    ![hue, saturation, lightness].every(Number.isFinite) ||
    saturation < 0 ||
    saturation > 100 ||
    lightness < 0 ||
    lightness > 100
  ) {
    throw new Error(COLOR_INPUT_ERROR);
  }
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const component = (offset: number) => {
    let value = h + offset;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [component(1 / 3) * 255, component(0) * 255, component(-1 / 3) * 255];
}

export function normalizeColorInput(input: string): string {
  const value = input.normalize('NFKC').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  const shortHex = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (shortHex)
    return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
  const rgb = value.match(
    /^rgb\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/,
  );
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const hsl = value.match(
    /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/,
  );
  if (hsl) return rgbToHex(...hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3])));
  throw new Error(COLOR_INPUT_ERROR);
}
