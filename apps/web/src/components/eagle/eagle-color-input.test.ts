import { describe, expect, it } from 'vitest';
import { normalizeColorInput } from './eagle-color-input';

describe('normalizeColorInput', () => {
  it('normalizes HEX, RGB and HSL to the same canonical color', () => {
    expect(normalizeColorInput('#2E86AB')).toBe('#2e86ab');
    expect(normalizeColorInput('rgb(46, 134, 171)')).toBe('#2e86ab');
    expect(normalizeColorInput('hsl(197, 58%, 43%)')).toBe('#2e89ad');
  });

  it('supports grayscale and rejects malformed colors', () => {
    expect(normalizeColorInput('rgb(128, 128, 128)')).toBe('#808080');
    expect(() => normalizeColorInput('navy blue')).toThrow('请输入 HEX、RGB 或 HSL 颜色');
    expect(() => normalizeColorInput('rgb(300, 0, 0)')).toThrow('请输入 HEX、RGB 或 HSL 颜色');
  });
});

