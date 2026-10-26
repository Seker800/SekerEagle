import { mediaWaitData } from '@sekereagle/library-core';
import { EmbeddingClientError } from './embedding-client';

/** Request backpressure is not host liveness, and neither consumes media failure attempts. */
export function embeddingBackoff(error: unknown) {
  if (!(error instanceof EmbeddingClientError)) return null;
  const offline = error.code === 'HOST_UNAVAILABLE';
  if (!offline && error.code !== 'HOST_BUSY' && error.code !== 'UPLOAD_TIMEOUT') return null;
  const delayMs = offline ? 30000 : Math.min(30000, Math.max(1000, error.retryAfterMs ?? 1000));
  return {
    delayMs,
    reason: offline
      ? 'WAITING_EMBEDDING_HOST'
      : error.code === 'HOST_BUSY'
        ? 'WAITING_EMBEDDING_CAPACITY'
        : 'WAITING_EMBEDDING_UPLOAD',
  };
}

/** Media/tag claims increment attempts before execution; a temporary wait gives it back. */
export function embeddingRetry(error: unknown, attempts: number, now = new Date()) {
  const backoff = embeddingBackoff(error);
  return backoff ? { data: mediaWaitData(attempts, backoff.delayMs, backoff.reason, now) } : null;
}
