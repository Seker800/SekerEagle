const INLINE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
]);

/** Database MIME is inspected at import; storage response metadata is never authoritative. */
export function safeMediaResponse(mimeType: string, fileName: string) {
  const type = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
  return {
    type,
    disposition: `${INLINE_MEDIA_TYPES.has(type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  };
}
