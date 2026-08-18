export type EmbeddingClientErrorCode =
  | 'PAYLOAD_TOO_LARGE'
  | 'HOST_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'MODEL_DRIFT';

export class EmbeddingClientError extends Error {
  constructor(
    readonly code: EmbeddingClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EmbeddingClientError';
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
  private readonly request: typeof fetch;

  constructor(private readonly options: EmbeddingClientOptions) {
    this.request = options.fetch ?? fetch;
  }

  async embedImage(bytes: Buffer, mimeType: string): Promise<{ embedding: number[] }> {
    if (bytes.byteLength > this.options.maxPayloadBytes) {
      throw new EmbeddingClientError(
        'PAYLOAD_TOO_LARGE',
        `Embedding payload exceeds ${this.options.maxPayloadBytes} bytes.`,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.request(`${stripTrailingSlash(this.options.baseUrl)}/v1/embeddings/image`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': mimeType,
          'x-embedding-dimensions': String(this.options.dimensions),
        },
        body: bytes,
        signal: controller.signal,
      });
    } catch (error) {
      throw new EmbeddingClientError('HOST_UNAVAILABLE', 'Embedding host is unavailable.', {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
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
      throw new EmbeddingClientError('INVALID_RESPONSE', 'Embedding host returned invalid JSON.', {
        cause: error,
      });
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
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

