import { EmbeddingClientError } from './embedding-client';

/** Request backpressure is not host liveness, and neither consumes media failure attempts. */
export function embeddingRetry(error: unknown, attempts: number, now = new Date()) {
  if (!(error instanceof EmbeddingClientError)) return null;
  const offline = error.code === 'HOST_UNAVAILABLE';
  if (!offline && error.code !== 'HOST_BUSY' && error.code !== 'UPLOAD_TIMEOUT') return null;
  const delay = offline ? 30000 : Math.min(30000, Math.max(1000, error.retryAfterMs ?? 1000));
  return {
    offline,
    data: {
      status: 'PENDING' as const,
      attempts: Math.max(0, attempts - 1),
      availableAt: new Date(now.getTime() + delay),
      lockedAt: null,
      lastError: offline
        ? 'WAITING_EMBEDDING_HOST'
        : error.code === 'HOST_BUSY'
          ? 'WAITING_EMBEDDING_CAPACITY'
          : 'WAITING_EMBEDDING_UPLOAD',
    },
  };
}
