import { describe, expect, it } from 'vitest';
import {
  MAX_CLIPBOARD_IMAGE_BYTES,
  parseClipboardImageInput,
} from '../src/main/clipboard-image';

const signature = [137, 80, 78, 71, 13, 10, 26, 10];

describe('desktop clipboard image input', () => {
  it('accepts a bounded PNG byte payload', () => {
    const bytes = Uint8Array.from([...signature, 1, 2, 3]);
    expect(parseClipboardImageInput({ contentType: 'image/png', bytes })).toBe(bytes);
  });

  it.each([
    null,
    { contentType: 'image/jpeg', bytes: Uint8Array.from(signature) },
    { contentType: 'image/png', bytes: 'not bytes' },
    { contentType: 'image/png', bytes: Uint8Array.from([1, 2, 3]) },
    {
      contentType: 'image/png',
      bytes: new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1),
    },
  ])('rejects malformed, non-PNG, and oversized payloads', (input) => {
    expect(() => parseClipboardImageInput(input)).toThrow(/载荷无效/);
  });
});
