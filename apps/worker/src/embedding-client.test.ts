import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbeddingClient, EmbeddingClientError } from './embedding-client';

test('EmbeddingClient sends bounded image bytes and validates model identity', async () => {
  const client = new EmbeddingClient({
    baseUrl: 'http://host.docker.internal:11435',
    token: 'test-token',
    modelId: 'Qwen/Qwen3-VL-Embedding-2B',
    modelRevision: 'test-revision',
    dimensions: 2,
    timeoutMs: 1_000,
    maxPayloadBytes: 1024,
    fetch: async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
      return new Response(
        JSON.stringify({
          embedding: [0.6, 0.8],
          model: 'Qwen/Qwen3-VL-Embedding-2B',
          revision: 'test-revision',
          dimensions: 2,
          normalized: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const result = await client.embedImage(Buffer.from('preview'), 'image/webp');
  assert.deepEqual(result.embedding, [0.6, 0.8]);
});

test('EmbeddingClient fails closed on oversized payloads and model drift', async () => {
  const oversized = new EmbeddingClient({
    baseUrl: 'http://host.docker.internal:11435',
    token: 'x',
    modelId: 'expected',
    modelRevision: 'expected-revision',
    dimensions: 2,
    timeoutMs: 1_000,
    maxPayloadBytes: 2,
    fetch,
  });
  await assert.rejects(() => oversized.embedImage(Buffer.from('large'), 'image/webp'), /payload/i);

  const drifted = new EmbeddingClient({
    baseUrl: 'http://host.docker.internal:11435',
    token: 'x',
    modelId: 'expected',
    modelRevision: 'expected-revision',
    dimensions: 2,
    timeoutMs: 1_000,
    maxPayloadBytes: 1024,
    fetch: async () =>
      new Response(
        JSON.stringify({
          embedding: [1, 0],
          model: 'unexpected',
          revision: 'expected-revision',
          dimensions: 2,
          normalized: true,
        }),
      ),
  });
  await assert.rejects(
    () => drifted.embedImage(Buffer.from('ok'), 'image/webp'),
    (error: unknown) => {
      if (!(error instanceof EmbeddingClientError)) return false;
      return error.code === 'MODEL_DRIFT';
    },
  );
});
