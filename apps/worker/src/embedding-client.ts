import { parseComputeRuntime, type ComputeRuntime } from './compute-runtime';
export type EmbeddingClientErrorCode =
  | 'PAYLOAD_TOO_LARGE'
  | 'HOST_UNAVAILABLE'
  | 'HOST_BUSY'
  | 'UPLOAD_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'MODEL_DRIFT';

export class EmbeddingClientError extends Error {
  readonly retryAfterMs?: number;
  readonly deferResource: boolean;
  constructor(
    readonly code: EmbeddingClientErrorCode,
    message: string,
    options?: ErrorOptions & { retryAfterMs?: number; deferResource?: boolean },
  ) {
    super(message, options);
    this.name = 'EmbeddingClientError';
    this.retryAfterMs = options?.retryAfterMs;
    this.deferResource = options?.deferResource ?? true;
  }
}

interface EmbeddingClientOptions {
  baseUrl: string;
  token: string;
  modelId: string;
  modelRevision: string;
  dimensions: number;
  timeoutMs: number;
  maxPayloadBytes: number;
  fetch?: typeof fetch;
}

interface EmbeddingResponse {
  embedding?: unknown;
  model?: unknown;
  revision?: unknown;
  dimensions?: unknown;
  normalized?: unknown;
}

export class EmbeddingClient {
  computeRuntime: ComputeRuntime | null = null;
  private readonly request: typeof fetch;

  constructor(private readonly options: EmbeddingClientOptions) {
    this.request = options.fetch ?? fetch;
  }

  async readiness(): Promise<'READY' | 'OFFLINE' | 'DRIFTED'> {
    this.computeRuntime = null;
    try {
      const response = await this.request(`${stripTrailingSlash(this.options.baseUrl)}/healthz`, {
        headers: { authorization: `Bearer ${this.options.token}` },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return 'OFFLINE';
      const data = (await response.json()) as {
        status?: unknown;
        model?: unknown;
        revision?: unknown;
        dimensions?: unknown;
        metal?: unknown;
        accelerator?: unknown;
        protocol?: unknown;
      };
      this.computeRuntime = parseComputeRuntime(data);
      if (
        this.computeRuntime &&
        data.accelerator === 'pool' &&
        data.status === 'offline' &&
        data.model === this.options.modelId &&
        data.revision === this.options.modelRevision &&
        data.dimensions === this.options.dimensions
      )
        return 'OFFLINE';
      return data.status === 'ready' &&
        data.model === this.options.modelId &&
        data.revision === this.options.modelRevision &&
        data.dimensions === this.options.dimensions &&
        (data.metal === true || (data.accelerator === 'pool' && this.computeRuntime !== null))
        ? 'READY'
        : 'DRIFTED';
    } catch {
      return 'OFFLINE';
    }
  }

  async embedImage(bytes: Buffer, mimeType: string): Promise<{ embedding: number[] }> {
    if (bytes.byteLength > this.options.maxPayloadBytes) {
      throw new EmbeddingClientError(
        'PAYLOAD_TOO_LARGE',
        `Embedding payload exceeds ${this.options.maxPayloadBytes} bytes.`,
      );
    }
    return this.requestEmbedding(
      `${stripTrailingSlash(this.options.baseUrl)}/v1/embeddings/image`,
      {
        'content-type': mimeType,
      },
      bytes,
    );
  }

  async embedText(text: string): Promise<{ embedding: number[] }> {
    const body = JSON.stringify({ text });
    if (Buffer.byteLength(body) > this.options.maxPayloadBytes) {
      throw new EmbeddingClientError(
        'PAYLOAD_TOO_LARGE',
        `Embedding payload exceeds ${this.options.maxPayloadBytes} bytes.`,
      );
    }
    return this.requestEmbedding(
      `${stripTrailingSlash(this.options.baseUrl)}/v1/embeddings/text`,
      { 'content-type': 'application/json' },
      body,
    );
  }

  private async requestEmbedding(
    url: string,
    headers: Record<string, string>,
    body: Buffer | string,
  ): Promise<{ embedding: number[] }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.request(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.token}`,
            ...headers,
            'x-embedding-dimensions': String(this.options.dimensions),
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        throw new EmbeddingClientError('HOST_UNAVAILABLE', 'Embedding host is unavailable.', {
          cause: error,
        });
      }
      if (response.status === 503 || response.status === 429) {
        throw new EmbeddingClientError('HOST_BUSY', 'Embedding capacity is busy.', {
          retryAfterMs: boundedRetryAfter(response.headers.get('retry-after')),
          deferResource: response.headers.get('x-compute-backpressure') !== 'node',
        });
      }
      if (response.status === 408) {
        throw new EmbeddingClientError('UPLOAD_TIMEOUT', 'Embedding upload timed out.', {
          retryAfterMs: 1000,
        });
      }
      if (!response.ok) {
        throw new EmbeddingClientError(
          response.status >= 500 ? 'HOST_UNAVAILABLE' : 'INVALID_RESPONSE',
          `Embedding host returned HTTP ${response.status}.`,
        );
      }
      let payload: EmbeddingResponse;
      try {
        payload = (await response.json()) as EmbeddingResponse;
      } catch (error) {
        throw new EmbeddingClientError(
          controller.signal.aborted ? 'HOST_UNAVAILABLE' : 'INVALID_RESPONSE',
          controller.signal.aborted
            ? 'Embedding response timed out.'
            : 'Embedding host returned invalid JSON.',
          { cause: error },
        );
      }
      if (
        payload.model !== this.options.modelId ||
        payload.revision !== this.options.modelRevision ||
        payload.dimensions !== this.options.dimensions ||
        payload.normalized !== true
      ) {
        throw new EmbeddingClientError('MODEL_DRIFT', 'Embedding model contract drifted.');
      }
      if (
        !Array.isArray(payload.embedding) ||
        payload.embedding.length !== this.options.dimensions ||
        payload.embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw new EmbeddingClientError('INVALID_RESPONSE', 'Embedding vector is invalid.');
      }
      const embedding = payload.embedding as number[];
      const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
      if (Math.abs(norm - 1) > 1e-3) {
        throw new EmbeddingClientError('INVALID_RESPONSE', 'Embedding vector is not normalized.');
      }
      return { embedding };
    } finally {
      clearTimeout(timer);
    }
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** HTTP Retry-After supports seconds and dates; never trust it to park work indefinitely. */
function boundedRetryAfter(value: string | null): number {
  if (!value) return 1000;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds)
    ? Math.min(30000, Math.max(1000, Math.ceil(seconds * 1000)))
    : 1000;
}
