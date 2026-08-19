import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureApiClient, normalizeServerUrl } from '../src/api-client.js';

test('accepts HTTPS and loopback HTTP servers while rejecting insecure remote endpoints', () => {
  assert.equal(normalizeServerUrl('https://eagle.example.com/'), 'https://eagle.example.com');
  assert.equal(normalizeServerUrl('http://127.0.0.1:8180'), 'http://127.0.0.1:8180');
  assert.throws(() => normalizeServerUrl('http://192.168.1.10:8180'));
  assert.throws(() => normalizeServerUrl('https://user:secret@example.com'));
});

test('keeps PAT authorization on control requests and never leaks it to presigned object uploads', async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/parts/1')) {
      return new Response(
        JSON.stringify({
          uploadUrl:
            'https://eagle.example.com/sekereagle-assets/user/image.jpg?X-Amz-Signature=signed',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('', { status: 200, headers: { etag: 'part-etag' } });
  };
  const api = new CaptureApiClient({
    serverUrl: 'https://eagle.example.com',
    pat: 'sea_pat_secret',
    fetchImpl,
  });

  const signed = await api.presignPart('13e84291-8ad7-4c44-aa76-29a45ce058b2', 1);
  await api.uploadPart(signed.uploadUrl, new Blob(['image']));

  assert.equal(requests[0].init.headers.authorization, 'Bearer sea_pat_secret');
  assert.equal(requests[1].init.headers?.authorization, undefined);
  assert.equal(requests[1].url.includes('sea_pat_secret'), false);
});

test('treats an in-progress server state conflict as retryable', async () => {
  const api = new CaptureApiClient({
    serverUrl: 'https://eagle.example.com',
    pat: 'sea_pat_secret',
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: '上传正在完成。' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(api.get('13e84291-8ad7-4c44-aa76-29a45ce058b2'), {
    kind: 'TRANSIENT',
    status: 409,
  });
});

test('preserves the browser global receiver when using native fetch', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = function () {
    assert.equal(this, globalThis);
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'PENDING' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const api = new CaptureApiClient({
    serverUrl: 'https://eagle.example.com',
    pat: 'sea_pat_secret',
  });

  const result = await api.initiate({ clientCaptureId: 'capture-1' });

  assert.equal(result.status, 'PENDING');
});
