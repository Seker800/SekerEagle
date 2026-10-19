import { describe, expect, it } from 'vitest';
import { editedPhotoName } from './photo-editor-save';

describe('edited photo names', () => {
  const now = new Date('2026-10-19T09:10:11.123Z');
  it('keeps the original base name and marks a new file as edited', () => {
    expect(editedPhotoName('旅行照片.JPG', now)).toBe('旅行照片-已编辑-20261019-091011-123.png');
  });
  it('bounds the name and removes path separators without splitting emoji', () => {
    const result = editedPhotoName('../' + '📷'.repeat(300) + '.png', now);
    expect(result.length).toBeLessThan(255);
    expect(result).not.toMatch(/[\\/]/);
    expect(result).not.toContain('\ufffd');
  });
});
