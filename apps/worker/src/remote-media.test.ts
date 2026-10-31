import { createServer } from 'node:http';
import { PermanentMediaValidationError } from './media-validation-error';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  createRemoteMediaServer,
  RemoteMediaClient,
  RemoteMediaUnavailableError,
} from './remote-media';
test('remote rejection keeps its HTTP cause instead of blaming a healthy source file', async (t) => {
  let status = 401;
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'IMAGE_PIXEL_LIMIT_EXCEEDED' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const client = new RemoteMediaClient(`http://127.0.0.1:${address.port}`, 'synthetic-token');
  const request = () =>
    client.image(Readable.from([Buffer.from('test')]), {
      assetMimeType: 'image/jpeg',
      sourceMimeType: 'image/jpeg',
      kind: 'GENERATE_RENDITIONS',
      mode: 'PHOTO',
      detailsOnly: false,
      verifiesOriginalHash: true,
    });
  await assert.rejects(request(), /REMOTE_MEDIA_HTTP_401/);
  status = 500;
  await assert.rejects(request(), /REMOTE_MEDIA_HTTP_500/);
  status = 422;
  await assert.rejects(request(), /IMAGE_PIXEL_LIMIT_EXCEEDED/);
  const previous = process.env.REMOTE_MEDIA_ERROR_MAX_BYTES;
  process.env.REMOTE_MEDIA_ERROR_MAX_BYTES = '0';
  try {
    await assert.rejects(request(), /INVALID_REMOTE_MEDIA_ERROR_MAX_BYTES/);
  } finally {
    if (previous === undefined) delete process.env.REMOTE_MEDIA_ERROR_MAX_BYTES;
    else process.env.REMOTE_MEDIA_ERROR_MAX_BYTES = previous;
  }
});
test('real HTTP pyramid work streams all validated tiles and rejects command-bearing recipes', async (t) => {
  const server = createRemoteMediaServer('test-media-token', 1, false, undefined, [
    'image',
    'pyramid',
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), 'remote-pyramid-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#345678' },
  })
    .jpeg()
    .toBuffer();
  const result = await new RemoteMediaClient(base, 'test-media-token').pyramid(
    Readable.from([source]),
    'image/jpeg',
    directory,
  );
  assert.equal(result.files.length, 12);
  assert.equal(result.descriptor.width, 640);
  const bad = await fetch(base + '/v1/media/pyramid', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-media-token',
      'content-type': 'application/octet-stream',
      'x-artifact-work': Buffer.from(
        JSON.stringify({ mimeType: 'image/jpeg', path: '/private' }),
      ).toString('base64url'),
    },
    body: source,
  });
  assert.equal(bad.status, 400);
  const forbidden = await fetch(base + '/v1/media/video', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-media-token',
      'content-type': 'application/octet-stream',
      'x-artifact-work': Buffer.from(
        JSON.stringify({ mimeType: 'video/mp4', stage: 'PLAYBACK' }),
      ).toString('base64url'),
    },
    body: source,
  });
  assert.equal(forbidden.status, 503);
});
test('real HTTP media execution validates auth and returns identical bounded renditions', async (t) => {
  const server = createRemoteMediaServer('test-media-token', 1);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(base + '/healthz')).status, 401);
  const health = (await (
    await fetch(base + '/healthz', { headers: { authorization: 'Bearer test-media-token' } })
  ).json()) as { operations: string[] };
  assert.ok(health.operations.includes('image'));
  const bytes = await sharp({
    create: { width: 48, height: 32, channels: 3, background: '#123abc' },
  })
    .jpeg()
    .toBuffer();
  const client = new RemoteMediaClient(base, 'test-media-token');
  const result = await client.image(
    (async function* () {
      yield bytes;
    })(),
    {
      assetMimeType: 'image/jpeg',
      sourceMimeType: 'image/jpeg',
      kind: 'GENERATE_RENDITIONS',
      mode: 'MATERIAL',
      detailsOnly: false,
      verifiesOriginalHash: true,
    },
  );
  assert.equal(result.result.rendered?.length, 3);
  assert.ok(result.sha256);
});

test('bad image data is permanent while host backpressure remains retryable', async (t) => {
  let status = 422;
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(status);
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const client = new RemoteMediaClient(`http://127.0.0.1:${address.port}`, 'test-media-token');
  await assert.rejects(client.faces(Buffer.from('invalid')), PermanentMediaValidationError);
  status = 503;
  await assert.rejects(client.faces(Buffer.from('invalid')), RemoteMediaUnavailableError);
});

test('source read failures keep the original error and consume ordinary retry budget', async (t) => {
  const server = createRemoteMediaServer('test-media-token');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const failure = new Error('synthetic object read interrupted');
  const client = new RemoteMediaClient(`http://127.0.0.1:${address.port}`, 'test-media-token');
  await assert.rejects(
    client.image(
      (async function* () {
        yield Buffer.from('partial');
        throw failure;
      })(),
      {
        assetMimeType: 'image/jpeg',
        sourceMimeType: 'image/jpeg',
        kind: 'GENERATE_RENDITIONS',
        mode: 'MATERIAL',
        detailsOnly: false,
        verifiesOriginalHash: true,
      },
    ),
    (error) => error === failure,
  );
});

test('unprobed face configuration is never advertised as ready', async (t) => {
  const previous = [process.env.PHOTO_FACE_PYTHON, process.env.PHOTO_FACE_MODEL_DIR];
  process.env.PHOTO_FACE_PYTHON = '/invalid/python';
  process.env.PHOTO_FACE_MODEL_DIR = '/invalid/models';
  t.after(() => {
    for (const [index, key] of ['PHOTO_FACE_PYTHON', 'PHOTO_FACE_MODEL_DIR'].entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  });
  const server = createRemoteMediaServer('test-media-token');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const health = (await (
    await fetch(`http://127.0.0.1:${address.port}/healthz`, {
      headers: { authorization: 'Bearer test-media-token' },
    })
  ).json()) as { operations: string[] };
  assert.deepEqual(health.operations, ['image']);
});

test('photo browsing rejects an oversized remote envelope before decoding or publication', async (t) => {
  const server = createServer((request, response) => {
    request.resume();
    response.end(Buffer.alloc(33 * 1024 ** 2));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  await assert.rejects(
    new RemoteMediaClient(`http://127.0.0.1:${address.port}`, 'test-token').image(
      Readable.from([Buffer.from('fixture')]),
      {
        assetMimeType: 'image/jpeg',
        sourceMimeType: 'image/jpeg',
        kind: 'GENERATE_RENDITIONS',
        mode: 'PHOTO',
        detailsOnly: false,
        verifiesOriginalHash: true,
      },
    ),
    /MEDIA_PAYLOAD_TOO_LARGE/,
  );
});

test('a video artifact at the forbidden 1 GiB boundary is rejected before any file is created', async (t) => {
  const { createHash } = await import('node:crypto');
  const { readdir } = await import('node:fs/promises');
  const input = Buffer.from('synthetic-source');
  const work = { mimeType: 'video/mp4', stage: 'PLAYBACK' } as const;
  const frame = (value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value)),
      length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const data = Buffer.concat([
    Buffer.from('SEA1'),
    frame({
      sha256: createHash('sha256').update(input).digest('hex'),
      work,
      metadata: { width: 96, height: 64, durationMs: 1000 },
      playbackMetadata: { width: 96, height: 64, durationMs: 1000 },
    }),
    frame({ name: 'preview.mp4', size: 1024 ** 3 }),
    Buffer.alloc(4),
  ]);
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/vnd.sekereagle.artifacts' });
    res.end(data);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const directory = await mkdtemp(join(tmpdir(), 'video-artifact-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    new RemoteMediaClient(`http://127.0.0.1:${address.port}`, 'test-token').video(
      Readable.from([input]),
      work,
      directory,
    ),
    /INVALID_VIDEO_RESULT/,
  );
  assert.deepEqual(await readdir(directory), []);
});

test('verified media capacity can exceed four while real HTTP requests remain bounded', async (t) => {
  const { request } = await import('node:http');
  const { setTimeout: delay } = await import('node:timers/promises');
  assert.throws(
    () => createRemoteMediaServer('test-media-token', 17),
    /INVALID_MEDIA_AGENT_CONFIGURATION/,
  );
  assert.doesNotThrow(() => createRemoteMediaServer('test-media-token', 16).close());
  const server = createRemoteMediaServer('test-media-token', 8, true, undefined, ['faces']);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const base = 'http://127.0.0.1:' + address.port;
  const headers = { authorization: 'Bearer test-media-token' };
  const requests = Array.from({ length: 8 }, () => {
    const req = request(base + '/v1/media/faces', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'image/jpeg', 'content-length': '32' },
    });
    req.on('error', () => {});
    req.flushHeaders();
    return req;
  });
  t.after(() => {
    requests.forEach((req) => req.destroy());
    server.closeAllConnections();
    server.close();
  });
  let active = 0;
  for (let i = 0; i < 100; i++) {
    const h = (await (await fetch(base + '/healthz', { headers })).json()) as {
      capacity: { limit: number; inFlight: number };
    };
    assert.equal(h.capacity.limit, 8);
    active = h.capacity.inFlight;
    if (active === 8) break;
    await delay(10);
  }
  assert.equal(active, 8);
  const overflow = await fetch(base + '/v1/media/faces', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/jpeg' },
    body: 'bad image',
  });
  assert.equal(overflow.status, 503);
  requests.forEach((req) => req.destroy());
  for (let i = 0; i < 100; i++) {
    const health = (await (await fetch(base + '/healthz', { headers })).json()) as {
      capacity: { inFlight: number };
    };
    active = health.capacity.inFlight;
    if (active === 0) break;
    await delay(10);
  }
  assert.equal(active, 0);
  const resumed = request(base + '/v1/media/faces', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/jpeg', 'content-length': '32' },
  });
  resumed.on('error', () => {});
  resumed.flushHeaders();
  requests.push(resumed);
  for (let i = 0; i < 100; i++) {
    const health = (await (await fetch(base + '/healthz', { headers })).json()) as {
      capacity: { inFlight: number };
    };
    active = health.capacity.inFlight;
    if (active === 1) break;
    await delay(10);
  }
  assert.equal(active, 1, 'released capacity must admit a new request');
});
