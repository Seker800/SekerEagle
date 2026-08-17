import { HttpException } from '@nestjs/common';

/**
 * Parse an HTTP Range header value into a form suitable for S3 GetObjectCommand.
 * Supports one RFC byte range: bytes=start-end, bytes=start-, or bytes=-suffixLength.
 * Returns `undefined` when the header is absent.
 * Throws an error for multi-range or syntactically invalid headers so the server
 * can respond with 416 Range Not Satisfiable rather than silently serving
 * the full object.
 */
export function parseRangeHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  // Multi-range requests use comma-separated ranges — reject explicitly
  if (header.includes(',')) {
    throw new Error('Multi-range requests are not supported');
  }
  const match = header.match(/^bytes=(?:(\d+)-(\d*)|-(\d+))$/);
  if (!match) {
    throw new Error('Malformed Range header');
  }
  const suffixLength = match[3];
  if (suffixLength !== undefined) {
    if (BigInt(suffixLength) === 0n) {
      throw new Error('Range suffix length must be positive');
    }
    return `bytes=-${suffixLength}`;
  }

  const start = match[1]!;
  const end = match[2] || undefined;
  // Reject inverted ranges (start > end) — they are syntactically valid
  // but semantically invalid per RFC 7233 §2.1.
  if (end !== undefined && BigInt(start) > BigInt(end)) {
    throw new Error('Range start exceeds end');
  }
  return end !== undefined ? `bytes=${start}-${end}` : `bytes=${start}-`;
}

export class RangeNotSatisfiableException extends HttpException {
  constructor(readonly fullSize: number | bigint) {
    super('Range Not Satisfiable', 416);
  }
}

export function isObjectRangeNotSatisfiableError(error: unknown): boolean {
  const maybeObjectError = error as {
    name?: string;
    Code?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };

  if (maybeObjectError.$metadata?.httpStatusCode === 416) {
    return true;
  }

  const codeLike = `${maybeObjectError.name ?? ''} ${maybeObjectError.Code ?? ''} ${maybeObjectError.code ?? ''}`;
  if (/InvalidRange|RequestedRangeNotSatisfiable|RangeNotSatisfiable/i.test(codeLike)) {
    return true;
  }

  const message = maybeObjectError.message ?? '';
  return /range/i.test(message) && /satisf/i.test(message);
}

export function setRangeNotSatisfiableHeaders(
  response: { status: (code: number) => void; setHeader: (name: string, value: string) => void },
  fullSize: number | bigint,
): void {
  response.status(416);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Range', `bytes */${String(fullSize)}`);
}

/**
 * Set HTTP 206 Partial Content response headers.
 *
 * Call from controllers that serve ranged content.  Sets Accept-Ranges,
 * Content-Range / Content-Length for partial responses, and Content-Length
 * for full responses.
 */
export function setPartialContentHeaders(
  response: { status: (code: number) => void; setHeader: (name: string, value: string) => void },
  range: string | undefined,
  contentRange: string | undefined,
  contentLength: number | bigint | undefined,
  fullSize: number | bigint,
): void {
  response.setHeader('Accept-Ranges', 'bytes');
  if (range && contentRange) {
    response.status(206);
    response.setHeader('Content-Range', contentRange);
    response.setHeader('Content-Length', String(contentLength ?? fullSize));
  } else {
    response.setHeader('Content-Length', String(fullSize));
  }
}
