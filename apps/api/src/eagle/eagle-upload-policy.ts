import { BadRequestException } from '@nestjs/common';

export function normalizeEagleUploadOriginalName(value: string): string {
  const name = value.normalize('NFKC').split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!name || name.length > 255 || [...name].some(isControlCharacter)) {
    throw new BadRequestException('文件名无效。');
  }
  return name;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
}

/** Bounds the database connection and locks held by atomic upload publication, excluding S3 IO. */
export function uploadPublicationTimeoutMs(): number {
  const value = Number(process.env.EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS ?? 30_000);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS must be a positive integer');
  return value;
}
