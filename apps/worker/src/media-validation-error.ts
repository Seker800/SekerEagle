import { BadRequestException } from '@nestjs/common';

export type PermanentMediaValidationCode =
  | 'IMAGE_PIXEL_LIMIT_EXCEEDED'
  | 'IMAGE_CONTENT_MISMATCH'
  | 'IMAGE_DECODE_FAILED'
  | 'CONTENT_SHA256_MISMATCH'
  | 'UNSUPPORTED_MEDIA_TYPE';

export class PermanentMediaValidationError extends BadRequestException {
  constructor(
    readonly code: PermanentMediaValidationCode,
    message: string = code,
  ) {
    super({ code, message });
    this.name = PermanentMediaValidationError.name;
    this.message = `${code}: ${message}`;
  }
}

export function isPermanentMediaValidationError(error: unknown): boolean {
  return error instanceof PermanentMediaValidationError || error instanceof BadRequestException;
}

export function classifyImageInputError(error: unknown): unknown {
  if (isPermanentMediaValidationError(error) || isTransientMediaSourceError(error)) return error;
  if (error instanceof Error && /pixel limit/i.test(error.message)) {
    return new PermanentMediaValidationError(
      'IMAGE_PIXEL_LIMIT_EXCEEDED',
      '图片像素数量超出安全限制。',
    );
  }
  return new PermanentMediaValidationError(
    'IMAGE_DECODE_FAILED',
    '无法解码该图片，请确认文件完整且格式受支持。',
  );
}

function isTransientMediaSourceError(error: unknown): boolean {
  const candidate = error as Partial<Error> & { code?: string | number; killed?: boolean };
  return (
    Boolean(candidate.killed) ||
    (typeof candidate.code === 'string' && TRANSIENT_MEDIA_SOURCE_ERROR_CODES.has(candidate.code))
  );
}

const TRANSIENT_MEDIA_SOURCE_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EIO',
  'EMFILE',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOENT',
  'ENOMEM',
  'ENOSPC',
  'ETIMEDOUT',
]);
