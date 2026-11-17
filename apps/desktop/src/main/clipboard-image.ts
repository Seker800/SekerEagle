export const MAX_CLIPBOARD_IMAGE_BYTES = 32 * 1024 ** 2;

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff]);

export interface ClipboardImagePayload {
  contentType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
}

export function parseClipboardImageInput(input: unknown): ClipboardImagePayload {
  if (!input || typeof input !== 'object') throw new Error('剪贴板图片载荷无效。');
  const candidate = input as { contentType?: unknown; bytes?: unknown };
  const contentType = candidate.contentType;
  if (contentType !== 'image/png' && contentType !== 'image/jpeg')
    throw new Error('剪贴板图片载荷无效。');
  if (!(candidate.bytes instanceof Uint8Array)) throw new Error('剪贴板图片载荷无效。');
  const bytes = candidate.bytes;
  const signature = contentType === 'image/png' ? PNG_SIGNATURE : JPEG_SIGNATURE;
  if (bytes.byteLength < signature.byteLength) throw new Error('剪贴板图片载荷无效。');
  if (bytes.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('剪贴板图片载荷无效。');
  if (!signature.every((byte, index) => bytes[index] === byte))
    throw new Error('剪贴板图片载荷无效。');
  return { contentType, bytes };
}
