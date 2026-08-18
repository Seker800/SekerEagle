'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApiClient } = require('../js/api-client');

test('maps the original resumable upload engine onto independent Eagle endpoints', async () => {
  const requests = [];
  const responses = [
    json({ id: 'session-1', partSizeBytes: 5 }),
    json({ parts: [], partSizeBytes: 5 }),
    json({ uploadUrl: 'http://localhost:8180/sekereagle-assets/key?signature=1' }),
    raw('', { etag: 'etag-1' }),
    json({ assetId: 'asset-1' }),
  ];
  const api = new ApiClient({
    baseUrl: 'http://localhost:8180',
    accessToken: 'sea_pat_test',
    minimumImportIntervalMs: 0,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return responses.shift();
    },
  });

  const session = await api.initiateUpload('run-1', 'item-1', {
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 5,
  });
  assert.equal(session.id, 'session-1');
  assert.deepEqual(await api.getUploadedParts('session-1'), { parts: [], partSizeBytes: 5 });
  assert.deepEqual(await api.uploadPart('session-1', 1, Buffer.from('hello')), {
    partNumber: 1,
    etag: 'etag-1',
    size: 5,
  });
  await api.completeUpload('session-1', [{ partNumber: 1, etag: 'etag-1' }]);

  assert.deepEqual(
    requests.map(({ url, init }) => `${init.method || 'GET'} ${url}`),
    [
      'POST http://localhost:8180/api/eagle/imports/run-1/items/item-1/upload',
      'GET http://localhost:8180/api/eagle/uploads/session-1/parts',
      'POST http://localhost:8180/api/eagle/uploads/session-1/parts/1',
      'PUT http://localhost:8180/sekereagle-assets/key?signature=1',
      'POST http://localhost:8180/api/eagle/uploads/session-1/complete',
    ],
  );
  assert.equal(requests[3].init.headers?.Authorization, undefined);
});

test('paces both import and upload-control API requests below the server throttle', async () => {
  let now = 0;
  const waits = [];
  const api = new ApiClient({
    baseUrl: 'http://localhost:8180',
    accessToken: 'sea_pat_test',
    minimumImportIntervalMs: 550,
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    fetchImpl: async () => json({ parts: [] }),
  });

  await api.getUploadedParts('session-1');
  await api.getRun('run-1');

  assert.deepEqual(waits, [550]);
});

function json(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

function raw(payload, headers) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => payload,
  };
}
