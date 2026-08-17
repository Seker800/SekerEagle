type AwsReadError = {
  name?: string;
  Code?: string;
  code?: string;
  $metadata?: { httpStatusCode?: number };
  $retryable?: unknown;
};

type ObjectReadRetryOptions = {
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (error: unknown, delayMs: number) => void;
};

const MIN_RETRY_DELAY_MS = 50;
const MAX_RETRY_DELAY_MS = 150;
const TRANSIENT_ERROR_NAMES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'NetworkingError',
  'RequestTimeout',
  'RequestTimeoutException',
  'SlowDown',
  'Throttling',
  'ThrottlingException',
  'TimeoutError',
  'TooManyRequestsException',
  'UnknownError',
]);

export function isRetryableObjectReadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as AwsReadError;
  const statusCode = candidate.$metadata?.httpStatusCode;
  if (statusCode !== undefined)
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  if (candidate.$retryable) return true;
  return [candidate.name, candidate.Code, candidate.code].some(
    (value) => value !== undefined && TRANSIENT_ERROR_NAMES.has(value),
  );
}

export async function executeObjectReadWithRetry<T>(
  execute: () => Promise<T>,
  options: ObjectReadRetryOptions = {},
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    if (!isRetryableObjectReadError(error)) throw error;
    const delayMs = retryDelayMs(options.random?.() ?? Math.random());
    options.onRetry?.(error, delayMs);
    await (options.sleep ?? sleep)(delayMs);
    return execute();
  }
}

function retryDelayMs(randomValue: number): number {
  const normalized = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0.5;
  return Math.round(MIN_RETRY_DELAY_MS + normalized * (MAX_RETRY_DELAY_MS - MIN_RETRY_DELAY_MS));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
