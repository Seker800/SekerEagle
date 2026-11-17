import { describe, expect, it } from 'vitest';
import { MAX_CLIPBOARD_IMAGE_BYTES, parseClipboardImageInput } from '../src/main/clipboard-image';

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const jpegSignature = [0xff, 0xd8, 0xff];

describe('desktop clipboard image input', () => {
  it('accepts bounded PNG and 4K share JPEG payloads', () => {
    const png = Uint8Array.from([...pngSignature, 1, 2, 3]);
    expect(parseClipboardImageInput({ contentType: 'image/png', bytes: png })).toEqual({
      contentType: 'image/png',
      bytes: png,
    });
    const jpeg = Uint8Array.from([...jpegSignature, 1, 2, 3]);
    expect(parseClipboardImageInput({ contentType: 'image/jpeg', bytes: jpeg })).toEqual({
      contentType: 'image/jpeg',
      bytes: jpeg,
    });
  });

  it.each([
    null,
    { contentType: 'image/jpeg', bytes: Uint8Array.from(pngSignature) },
    { contentType: 'image/png', bytes: Uint8Array.from(jpegSignature) },
    { contentType: 'image/gif', bytes: Uint8Array.from(pngSignature) },
    { contentType: 'image/png', bytes: 'not bytes' },
    { contentType: 'image/png', bytes: Uint8Array.from([1, 2, 3]) },
    { contentType: 'image/png', bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) },
    {
      contentType: 'image/png',
      bytes: new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1),
    },
  ])('rejects malformed, mismatched, and oversized payloads', (input) => {
    expect(() => parseClipboardImageInput(input)).toThrow(/载荷无效/);
  });
});
