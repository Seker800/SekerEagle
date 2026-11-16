import { PermanentMediaValidationError } from '../media-validation-error';

export async function readBoundedBytes(
  source: AsyncIterable<Uint8Array>,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > maximumBytes) throw new Error('EMBEDDING_PREVIEW_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

export function assertOwnedKey(ownerId: string, key: string): void {
  if (!key.startsWith(`users/${ownerId}/`)) throw new Error('CROSS_OWNER_OBJECT_KEY');
}

export function assertExpectedHash(expected: string | null | undefined, actual: string): void {
  if (expected && expected !== actual)
    throw new PermanentMediaValidationError('CONTENT_SHA256_MISMATCH');
}
