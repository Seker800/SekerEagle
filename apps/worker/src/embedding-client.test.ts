import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbeddingClient, EmbeddingClientError } from './embedding-client';

test('model readiness is checked before claiming work and rejects a different model contract', async () => {
  const options = {
    baseUrl: 'http://127.0.0.1:11435',
    token: 'synthetic-test',
    modelId: 'expected',
    modelRevision: 'revision',
    dimensions: 2,
    timeoutMs: 1000,
    maxPayloadBytes: 1024,
  };
  assert.equal(
    await new EmbeddingClient({
      ...options,
      fetch: async () => {
        throw new Error('offline');
      },
    }).readiness(),
    'OFFLINE',
  );
  assert.equal(
    await new EmbeddingClient({
      ...options,
      fetch: async () =>
        Response.json({
          status: 'ready',
          model: 'other',
          revision: 'revision',
          dimensions: 2,
          metal: true,
        }),
    }).readiness(),
    'DRIFTED',
  );
  assert.equal(
    await new EmbeddingClient({
      ...options,
      fetch: async () =>
        Response.json({
          status: 'ready',
          model: 'expected',
          revision: 'revision',
          dimensions: 2,
          metal: true,
        }),
    }).readiness(),
    'READY',
  );
});

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

test('EmbeddingClient embeds a contextualized AI tag as text', async () => {
  let requestedUrl = '';
  let requestedBody = '';
  const client = new EmbeddingClient({
    baseUrl: 'http://host.docker.internal:11435',
    token: 'test-token',
    modelId: 'Qwen/Qwen3-VL-Embedding-2B',
    modelRevision: 'test-revision',
    dimensions: 2,
    timeoutMs: 1_000,
    maxPayloadBytes: 1024,
    fetch: async (input, init) => {
      requestedUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const requestBody = init?.body;
      assert.equal(typeof requestBody, 'string');
      requestedBody = requestBody as string;
      return new Response(
        JSON.stringify({
          embedding: [0.6, 0.8],
          model: 'Qwen/Qwen3-VL-Embedding-2B',
          revision: 'test-revision',
          dimensions: 2,
          normalized: true,
        }),
      );
    },
  });

  const result = await client.embedText('图片中的具体物体或场景：汽车');

  assert.equal(requestedUrl.endsWith('/v1/embeddings/text'), true);
  assert.deepEqual(JSON.parse(requestedBody), { text: '图片中的具体物体或场景：汽车' });
  assert.deepEqual(result.embedding, [0.6, 0.8]);
});

test('capacity and upload waits are retryable without declaring a reachable model offline', async () => {
  for (const [status, header, code, delay] of [
    [503, '1', 'HOST_BUSY', 1000],
    [503, '999999', 'HOST_BUSY', 30000],
    [503, '-4', 'HOST_BUSY', 1000],
    [429, undefined, 'HOST_BUSY', 1000],
    [408, undefined, 'UPLOAD_TIMEOUT', 1000],
    [502, undefined, 'HOST_UNAVAILABLE', undefined],
  ] as const) {
    const client = new EmbeddingClient({
      baseUrl: 'http://127.0.0.1:11435',
      token: 'test',
      modelId: 'test',
      modelRevision: 'v1',
      dimensions: 2,
      timeoutMs: 1000,
      maxPayloadBytes: 1024,
      fetch: async () =>
        new Response(null, { status, headers: header ? { 'retry-after': header } : {} }),
    });
    await assert.rejects(
      () => client.embedImage(Buffer.from('preview'), 'image/jpeg'),
      (error: unknown) => {
        assert(error instanceof EmbeddingClientError);
        assert.equal(error.code, code);
        assert.equal(
          (error as EmbeddingClientError & { retryAfterMs?: number }).retryAfterMs,
          delay,
        );
        return true;
      },
    );
  }
});

test('the request deadline also covers a response body that stalls after successful headers', async () => {
  const client = new EmbeddingClient({
    baseUrl: 'http://127.0.0.1:11435',
    token: 'test',
    modelId: 'test',
    modelRevision: 'v1',
    dimensions: 2,
    timeoutMs: 20,
    maxPayloadBytes: 1024,
    fetch: async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
            controller.enqueue(new TextEncoder().encode('{"embedding":'));
          },
        }),
        { status: 200 },
      ),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(
      Promise.race([
        client.embedImage(Buffer.from('preview'), 'image/jpeg'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('response body exceeded deadline')), 200);
        }),
      ]),
      (error: unknown) =>
        error instanceof EmbeddingClientError && error.code === 'HOST_UNAVAILABLE',
    );
  } finally {
    clearTimeout(timer);
  }
});

test('verified coordinator reports live capacity without pretending to be Metal', async () => {
  const client = new EmbeddingClient({
    baseUrl: 'http://127.0.0.1:11436',
    token: 'test',
    modelId: 'expected',
    modelRevision: 'revision',
    dimensions: 2,
    timeoutMs: 1000,
    maxPayloadBytes: 1024,
    fetch: async () =>
      Response.json({
        status: 'ready',
        model: 'expected',
        revision: 'revision',
        dimensions: 2,
        accelerator: 'pool',
        protocol: 'sekereagle-compute-v1',
        capacity: { backgroundLimit: 4 },
        fleet: { revision: 1, nodes: [] },
      }),
  });
  assert.equal(await client.readiness(), 'READY');
  assert.equal(client.computeRuntime?.backgroundLimit, 4);
});

test('an enrolled pool without an available embedding host is offline, not contract drift',async()=>{
 const client=new EmbeddingClient({baseUrl:'http://127.0.0.1:11436',token:'test',modelId:'expected',modelRevision:'revision',dimensions:2,timeoutMs:1000,maxPayloadBytes:1024,fetch:async()=>Response.json({status:'offline',model:'expected',revision:'revision',dimensions:2,accelerator:'pool',protocol:'sekereagle-compute-v1',capacity:{backgroundLimit:0},fleet:{revision:1,nodes:[]}})});
 assert.equal(await client.readiness(),'OFFLINE');assert.equal(client.computeRuntime?.backgroundLimit,0);
});
