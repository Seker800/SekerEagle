export const MAX_CLIPBOARD_IMAGE_BYTES = 32 * 1024 ** 2;

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function parseClipboardImageInput(input: unknown): Uint8Array {
  if (!input || typeof input !== 'object') throw new Error('剪贴板图片载荷无效。');
  const candidate = input as { contentType?: unknown; bytes?: unknown };
  if (candidate.contentType !== 'image/png' || !(candidate.bytes instanceof Uint8Array)) {
    throw new Error('剪贴板图片载荷无效。');
  }
  const bytes = candidate.bytes;
  if (bytes.byteLength < PNG_SIGNATURE.byteLength) {
    throw new Error('剪贴板图片载荷无效。');
  }
  if (bytes.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error('剪贴板图片载荷无效。');
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error('剪贴板图片载荷无效。');
  }
  return bytes;
}
