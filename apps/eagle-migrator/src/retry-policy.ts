export type FailureDisposition = 'RETRYABLE' | 'REJECTED';

export interface FailureLike {
  status?: number;
  code?: string;
}

export function classifyFailure(error: FailureLike): FailureDisposition {
  if (error.status === 429 || (error.status !== undefined && error.status >= 500)) {
    return 'RETRYABLE';
  }
  if (
    error.code === 'ECONNRESET' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'EPIPE' ||
    error.code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return 'RETRYABLE';
  }
  return 'REJECTED';
}

export function retryDelayMilliseconds(
  attempt: number,
  options: { random?: () => number; retryAfterMilliseconds?: number } = {},
): number {
  const boundedAttempt = Math.max(1, Math.min(16, Math.trunc(attempt)));
  const exponential = Math.min(60_000, 1_000 * 2 ** (boundedAttempt - 1));
  const random = options.random ?? Math.random;
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * Math.min(5_000, exponential / 4));
  return Math.max(exponential + jitter, options.retryAfterMilliseconds ?? 0);
}

