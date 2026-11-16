import { expect, it } from 'vitest';
import { mediaProcessingFailure } from './media-processing-error';

it('explains truncated or undecodable files without offering a pointless retry', () => {
  for (const code of [
    'IMAGE_DECODE_FAILED: failed',
    'IMAGE_CONTENT_MISMATCH: Remote media rejected invalid input.',
  ]) {
    const failure = mediaProcessingFailure(code);
    expect(failure.label).toBe('文件不完整');
    expect(failure.retryable).toBe(false);
    expect(failure.detail).toContain('重新导出');
  }
});

it('keeps retry available for transient processing failures', () => {
  const failure = mediaProcessingFailure(null);
  expect(failure.label).toBe('处理失败');
  expect(failure.retryable).toBe(true);
});
