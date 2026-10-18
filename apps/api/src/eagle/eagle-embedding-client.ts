import { Injectable } from '@nestjs/common';
import { EAGLE_EMBEDDING_DIMENSIONS, EAGLE_EMBEDDING_MODEL } from './eagle-vector-semantics';

@Injectable()
export class EagleEmbeddingClient {
  async embedText(text: string): Promise<{ embedding: number[]; revision: string }> {
    const baseUrl = process.env.MLX_EMBEDDING_URL?.replace(/\/+$/, '');
    const token = process.env.MLX_EMBEDDING_TOKEN;
    if (!baseUrl || !token) throw new Error('MLX_EMBEDDING_NOT_CONFIGURED');
    const response = await fetch(`${baseUrl}/v1/embeddings/text`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-embedding-dimensions': String(EAGLE_EMBEDDING_DIMENSIONS),
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`MLX_EMBEDDING_HTTP_${response.status}`);
    const payload = (await response.json()) as {
      embedding?: unknown;
      revision?: unknown;
      model?: unknown;
      dimensions?: unknown;
      normalized?: unknown;
    };
    if (
      payload.revision !==
        (process.env.MLX_EMBEDDING_REVISION ?? '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda') ||
      payload.model !== EAGLE_EMBEDDING_MODEL ||
      payload.dimensions !== EAGLE_EMBEDDING_DIMENSIONS ||
      payload.normalized !== true ||
      !Array.isArray(payload.embedding) ||
      payload.embedding.length !== EAGLE_EMBEDDING_DIMENSIONS ||
      payload.embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw new Error('MLX_EMBEDDING_CONTRACT_DRIFT');
    }
    return { embedding: payload.embedding as number[], revision: payload.revision };
  }
}
