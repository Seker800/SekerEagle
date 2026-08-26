import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueueRunner } from '../src/queue-runner.js';

test('converges locally when the server already completed a replayed capture', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.1.0' }) } },
  });
  const job = {
    id: '13e84291-8ad7-4c44-aa76-29a45ce058b2',
    status: 'PENDING',
    sourceUrl: 'https://cdn.example.com/photo.jpg',
    metadata: {
      displayName: 'Photo',
      pageTitle: 'Gallery',
      pageUrl: 'https://example.com/gallery',
      imageUrl: 'https://cdn.example.com/photo.jpg',
      altText: 'Photo',
    },
    capturedAt: '2026-08-19T00:00:00.000Z',
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    blob: new Blob(['image'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    originalName: 'photo.jpg',
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  let requests = 0;
  const terminalStates = [];
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({
      serverUrl: 'https://eagle.example.com',
      pat: 'sea_pat_test',
      concurrency: 3,
    }),
    fetchImpl: async () => {
      requests += 1;
      return new Response(
        JSON.stringify({
          clientCaptureId: job.id,
          uploadSessionId: 'upload-1',
          status: 'COMPLETED',
          assetId: 'asset-1',
          partSize: 5_242_880,
          replayed: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
    onTerminalState: async (result) => terminalStates.push(result),
  });

  await runner.drain();

  assert.equal(requests, 1);
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.assetId, 'asset-1');
  assert.equal(job.blob, null);
  assert.deepEqual(terminalStates, [
    {
      id: job.id,
      metadata: job.metadata,
      originTabId: undefined,
      originFrameId: undefined,
      status: 'COMPLETED',
      assetId: 'asset-1',
      duplicate: undefined,
    },
  ]);
});

test('reports an actionable terminal state when capture configuration is missing', async () => {
  const job = {
    id: 'capture-without-config',
    status: 'PENDING',
    metadata: { displayName: 'Missing config' },
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  const terminalStates = [];
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({ pat: '' }),
    onTerminalState: async (result) => terminalStates.push(result),
  });

  await runner.drain();

  assert.equal(job.status, 'WAITING_CONFIG');
  assert.equal(terminalStates.length, 1);
  assert.equal(terminalStates[0].status, 'WAITING_CONFIG');
  assert.match(terminalStates[0].lastError, /PAT/);
});

test('reuses committed part metadata when server finalization needs recovery', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.1.0' }) } },
  });
  const job = {
    id: '13e84291-8ad7-4c44-aa76-29a45ce058b2',
    status: 'RETRY',
    sourceUrl: 'https://cdn.example.com/photo.jpg',
    metadata: {
      displayName: 'Photo',
      pageTitle: 'Gallery',
      pageUrl: 'https://example.com/gallery',
      imageUrl: 'https://cdn.example.com/photo.jpg',
      altText: 'Photo',
    },
    capturedAt: '2026-08-19T00:00:00.000Z',
    createdAt: 1,
    attempts: 1,
    nextAttemptAt: 0,
    blob: new Blob(['image'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    originalName: 'photo.jpg',
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  const requests = [];
  const responses = [
    {
      clientCaptureId: job.id,
      uploadSessionId: 'upload-1',
      status: 'FAILED',
      assetId: null,
      partSize: 5_242_880,
      replayed: true,
    },
    { uploadSessionId: 'upload-1', parts: [{ partNumber: 1, etag: 'stored-etag' }] },
    { assetId: 'asset-1', duplicate: false, status: 'PROCESSING' },
  ];
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({
      serverUrl: 'https://eagle.example.com',
      pat: 'sea_pat_test',
      concurrency: 3,
    }),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await runner.drain();

  assert.equal(requests.length, 3);
  assert.equal(
    requests.some(({ url }) => url.includes('/parts/1')),
    false,
  );
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    parts: [{ partNumber: 1, etag: 'stored-etag' }],
  });
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.assetId, 'asset-1');
});

test('automatic connection falls back from unavailable loopback to the public endpoint', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.1.0' }) } },
  });
  const job = {
    id: '13e84291-8ad7-4c44-aa76-29a45ce058b2',
    status: 'PENDING',
    sourceUrl: 'https://cdn.example.com/photo.jpg',
    metadata: {
      displayName: 'Photo',
      pageTitle: 'Gallery',
      pageUrl: 'https://example.com/gallery',
      imageUrl: 'https://cdn.example.com/photo.jpg',
      altText: 'Photo',
    },
    capturedAt: '2026-08-19T00:00:00.000Z',
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    blob: new Blob(['image'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    originalName: 'photo.jpg',
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  const requests = [];
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({
      connectionMode: 'auto',
      localServerUrl: 'http://localhost:8180',
      publicServerUrl: 'http://203.0.113.10:8180',
      allowInsecurePublicHttp: true,
      pat: 'sea_pat_test',
      concurrency: 3,
    }),
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).startsWith('http://localhost:8180')) {
        throw new TypeError('connection refused');
      }
      return new Response(
        JSON.stringify({
          clientCaptureId: job.id,
          uploadSessionId: 'upload-1',
          status: 'COMPLETED',
          assetId: 'asset-public',
          partSize: 5_242_880,
          replayed: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  await runner.drain();

  assert.deepEqual(
    requests.map((url) => new URL(url).origin),
    ['http://localhost:8180', 'http://203.0.113.10:8180'],
  );
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.assetId, 'asset-public');
});

test('reports restored connectivity after the server accepts a capture', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.2.0' }) } },
  });
  const job = {
    id: 'restored-capture',
    status: 'RETRY',
    metadata: {
      displayName: 'Restored',
      pageUrl: 'https://example.com/gallery',
      imageUrl: 'https://cdn.example.com/restored.jpg',
    },
    capturedAt: '2026-08-24T00:00:00.000Z',
    createdAt: 1,
    attempts: 2,
    nextAttemptAt: 0,
    blob: new Blob(['image'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    originalName: 'restored.jpg',
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  const restored = [];
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({ serverUrl: 'https://eagle.example.com', pat: 'sea_pat_test' }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          status: 'COMPLETED',
          assetId: 'asset-restored',
          partSize: 5_242_880,
          replayed: true,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    onConnectionRestored: async (event) => restored.push(event),
  });

  await runner.drain();

  assert.deepEqual(restored, [{ successfulJobId: 'restored-capture' }]);
  assert.equal(job.lastFailureStage, null);
});

test('records whether a transient failure came from source download or the server', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.2.0' }) } },
  });
  const sourceJob = {
    id: 'source-failure',
    status: 'PENDING',
    sourceUrl: 'https://cdn.example.com/missing.jpg',
    sourceCandidates: ['https://cdn.example.com/missing.jpg'],
    metadata: { pageUrl: 'https://example.com/gallery', imageUrl: '' },
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    blob: null,
  };
  const sourceStore = {
    list: async () => [sourceJob],
    update: async (_id, changes) => Object.assign(sourceJob, changes),
  };
  await createQueueRunner({
    store: sourceStore,
    getConfig: async () => ({ serverUrl: 'https://eagle.example.com', pat: 'sea_pat_test' }),
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  }).drain();
  assert.equal(sourceJob.status, 'RETRY');
  assert.equal(sourceJob.lastFailureStage, 'SOURCE_DOWNLOAD');

  const serverJob = {
    ...sourceJob,
    id: 'server-failure',
    status: 'PENDING',
    createdAt: 2,
    nextAttemptAt: 0,
    blob: new Blob(['image'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    originalName: 'server.jpg',
  };
  const serverStore = {
    list: async () => [serverJob],
    update: async (_id, changes) => Object.assign(serverJob, changes),
  };
  await createQueueRunner({
    store: serverStore,
    getConfig: async () => ({ serverUrl: 'https://eagle.example.com', pat: 'sea_pat_test' }),
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  }).drain();
  assert.equal(serverJob.status, 'RETRY');
  assert.equal(serverJob.lastFailureStage, 'SERVER_CONNECT');
});

test('uses native WorkerGlobalScope fetch without losing its receiver', async (t) => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.1.2' }) } },
  });
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  globalThis.fetch = function (url) {
    assert.equal(this, globalThis);
    requests.push(String(url));
    if (String(url).startsWith('https://cdn.example.com/')) {
      return Promise.resolve(new Response('image', { headers: { 'content-type': 'image/jpeg' } }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          clientCaptureId: job.id,
          uploadSessionId: 'upload-1',
          status: 'COMPLETED',
          assetId: 'asset-1',
          partSize: 5_242_880,
          replayed: false,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  const job = {
    id: '13e84291-8ad7-4c44-aa76-29a45ce058b2',
    status: 'PENDING',
    sourceUrl: 'https://cdn.example.com/photo.jpg',
    metadata: {
      displayName: 'Photo',
      pageTitle: 'Gallery',
      pageUrl: 'https://example.com/gallery',
      imageUrl: 'https://cdn.example.com/photo.jpg',
      altText: 'Photo',
    },
    capturedAt: '2026-08-19T00:00:00.000Z',
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    blob: null,
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({
      serverUrl: 'https://eagle.example.com',
      pat: 'sea_pat_test',
      concurrency: 3,
    }),
  });

  await runner.drain();

  assert.deepEqual(requests, [
    'https://cdn.example.com/photo.jpg',
    `https://eagle.example.com/api/eagle/browser-captures`,
  ]);
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.assetId, 'asset-1');
});

test('keeps a supported AVIF high-resolution candidate and records its sanitized source', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.1.4' }) } },
  });
  const job = {
    id: '13e84291-8ad7-4c44-aa76-29a45ce058b2',
    status: 'PENDING',
    sourceUrl: 'https://cdn.example.com/original.avif?token=secret',
    sourceCandidates: [
      'https://cdn.example.com/original.avif?token=secret',
      'https://cdn.example.com/original.jpg?token=secret',
      'https://cdn.example.com/rendered.jpg',
    ],
    metadata: {
      displayName: 'Photo',
      pageTitle: 'Gallery',
      pageUrl: 'https://example.com/gallery',
      imageUrl: 'https://cdn.example.com/original.avif',
      altText: 'Photo',
    },
    capturedAt: '2026-08-19T00:00:00.000Z',
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    blob: null,
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  const requests = [];
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({
      serverUrl: 'https://eagle.example.com',
      pat: 'sea_pat_test',
      concurrency: 3,
    }),
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('token=secret') && String(url).includes('.avif')) {
        return new Response('avif', { headers: { 'content-type': 'image/avif' } });
      }
      if (String(url).endsWith('token=secret') && String(url).includes('.jpg')) {
        return new Response('image', { headers: { 'content-type': 'image/jpeg' } });
      }
      return new Response(
        JSON.stringify({
          clientCaptureId: job.id,
          uploadSessionId: 'upload-1',
          status: 'COMPLETED',
          assetId: 'asset-hd',
          partSize: 5_242_880,
          replayed: false,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });

  await runner.drain();

  assert.deepEqual(requests, [
    'https://cdn.example.com/original.avif?token=secret',
    'https://eagle.example.com/api/eagle/browser-captures',
  ]);
  assert.equal(job.sourceUrl, 'https://cdn.example.com/original.avif?token=secret');
  assert.equal(job.metadata.imageUrl, 'https://cdn.example.com/original.avif');
  assert.equal(job.mimeType, 'image/avif');
  assert.equal(job.status, 'COMPLETED');
});

test('uses the visible PNG fallback when every original source is unavailable', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getManifest: () => ({ version: '0.2.0' }) } },
  });
  const job = {
    id: 'capture-rendered-fallback',
    status: 'PENDING',
    sourceUrl: 'https://protected.example.com/original.avif',
    sourceCandidates: ['https://protected.example.com/original.avif'],
    fallbackBlob: new Blob(['rendered'], { type: 'image/png' }),
    metadata: {
      displayName: 'Protected artwork',
      pageTitle: 'Gallery',
      pageUrl: 'https://protected.example.com/gallery',
      imageUrl: 'https://protected.example.com/original.avif',
      altText: 'Protected artwork',
    },
    capturedAt: '2026-08-22T00:00:00.000Z',
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    blob: null,
  };
  const store = {
    list: async () => [job],
    update: async (_id, changes) => Object.assign(job, changes),
  };
  const requests = [];
  const runner = createQueueRunner({
    store,
    getConfig: async () => ({
      serverUrl: 'https://eagle.example.com',
      pat: 'sea_pat_test',
      concurrency: 1,
    }),
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).startsWith('https://protected.example.com/')) {
        return new Response('', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          clientCaptureId: job.id,
          uploadSessionId: 'upload-rendered',
          status: 'COMPLETED',
          assetId: 'asset-rendered',
          partSize: 5_242_880,
          replayed: false,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });

  await runner.drain();

  assert.deepEqual(requests, [
    'https://protected.example.com/original.avif',
    'https://eagle.example.com/api/eagle/browser-captures',
  ]);
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.mimeType, 'image/png');
  assert.equal(job.originalName, 'Protected artwork.png');
  assert.equal(job.fallbackBlob, null);
});
