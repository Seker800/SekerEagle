/** Apple pairing identifiers are UUIDs, never filenames or paths. */
export function normalizeLivePhotoIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.replace(/\0+$/, '').trim().toLowerCase();
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id) ? id : null;
}
/** Apple iOS MakerNotes offsets are relative to the MakerNote, not the outer TIFF. */
export function readAppleLivePhotoIdentifier(input: Uint8Array): string | null {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (
    bytes.length < 16 ||
    bytes.length > 1024 * 1024 ||
    bytes.toString('ascii', 0, 10) !== 'Apple iOS\0'
  )
    return null;
  const order = bytes.toString('ascii', 12, 14);
  if (order !== 'MM' && order !== 'II') return null;
  const u16 = (offset: number) =>
    order === 'II' ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const u32 = (offset: number) =>
    order === 'II' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const count = u16(14);
  if (count > 1024 || 16 + count * 12 > bytes.length) return null;
  for (let index = 0; index < count; index++) {
    const entry = 16 + index * 12;
    if (u16(entry) !== 0x11 || u16(entry + 2) !== 2) continue;
    const size = u32(entry + 4),
      offset = u32(entry + 8);
    if (size < 36 || size > 128 || offset < 16 + count * 12 || offset + size > bytes.length)
      return null;
    return normalizeLivePhotoIdentifier(bytes.toString('ascii', offset, offset + size));
  }
  return null;
}
export const LIVE_PHOTO_MAX_VIDEO_BYTES = 64 * 1024 * 1024;
export const LIVE_PHOTO_MAX_DURATION_MS = 15000;
/** Bounded XMP inspection does not execute XML, entities or namespace content. */
export function readMotionPhotoRange(
  xmp: string,
  fileSize: number,
): { start: number; length: number } | null {
  if (xmp.length > 1024 * 1024 || !Number.isSafeInteger(fileSize) || fileSize <= 0) return null;
  const attribute = (text: string, name: string) =>
    text.match(new RegExp(`(?:[\\w-]+:)?${name}\\s*=\\s*["']([^"']{1,128})["']`))?.[1];
  if (attribute(xmp, 'MotionPhoto') === '0') return null;
  let length = 0,
    padding = 0;
  const items = xmp.match(/<(?:[\w-]+:)?Item\b[^>]{0,4096}>/g) ?? [];
  const motion = items.find(
    (item) =>
      attribute(item, 'Semantic') === 'MotionPhoto' && attribute(item, 'Mime') === 'video/mp4',
  );
  if (motion) {
    const raw = attribute(motion, 'Length'),
      pad = attribute(motion, 'Padding') ?? '0';
    if (!raw || !/^\d{1,12}$/.test(raw) || !/^\d{1,12}$/.test(pad)) return null;
    length = Number(raw);
    padding = Number(pad);
  } else if (attribute(xmp, 'MicroVideo') === '1') {
    const raw = attribute(xmp, 'MicroVideoOffset');
    if (!raw || !/^\d{1,12}$/.test(raw)) return null;
    length = Number(raw);
  }
  const start = fileSize - length - padding;
  return length >= 12 &&
    length <= LIVE_PHOTO_MAX_VIDEO_BYTES &&
    start >= 2 &&
    Number.isSafeInteger(start)
    ? { start, length }
    : null;
}
