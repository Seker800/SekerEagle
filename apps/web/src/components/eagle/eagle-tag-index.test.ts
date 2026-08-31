import { describe, expect, it } from 'vitest';
import { normalizeEagleTagSearchText } from './eagle-tag-index';

describe('Eagle tag search normalization', () => {
  it('normalizes user data independently from the display locale', () => {
    expect(normalizeEagleTagSearchText('  ＣＡＲ 图像  ')).toBe('car 图像');
    expect(normalizeEagleTagSearchText('灵感')).toBe('灵感');
  });
});
