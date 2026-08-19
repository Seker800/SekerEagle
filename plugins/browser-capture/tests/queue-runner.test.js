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
  });

  await runner.drain();

  assert.equal(requests, 1);
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.assetId, 'asset-1');
  assert.equal(job.blob, null);
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
