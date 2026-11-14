import assert from 'node:assert/strict';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';

/** Called only by the disposable, loopback photo workbench, never the fixed user test library. */
export async function verifyUploadPublication({
  db,
  ownerId,
  origin,
  cookie,
  mode,
  source,
  bytes,
}) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname));
  const libraryMode = mode === 'photos' ? 'PHOTO' : 'MATERIAL';
  const sourceBefore = await db.eagleAsset.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(sourceBefore.ownerId, ownerId);
  assert.equal(sourceBefore.libraryMode, libraryMode);
  const countBefore = await db.eagleAsset.count({ where: { ownerId, libraryMode } });
  const post = async (path, body) => {
    const response = await fetch(`${origin}/api/${mode}/${path}`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const get = async (path) => {
    const response = await fetch(`${origin}/api/${mode}/${path}`, {
      headers: { cookie, origin },
    });
    return { status: response.status, body: await response.json() };
  };
  const created = await post('uploads', {
    originalName: 'publication-lock-regression.png',
    mimeType: 'image/png',
    size: bytes.length,
    duplicatePolicy: 'CREATE_COPY',
    copySourceAssetId: source.id,
    copySourceRowVersion: source.rowVersion,
  });
  assert.equal(created.status, 201);
  const sessionId = created.body.id;
  const signed = await post(`uploads/${sessionId}/parts/1`, {});
  assert.equal(signed.status, 201);
  const uploaded = await fetch(signed.body.uploadUrl, { method: 'PUT', body: bytes });
  assert.equal(uploaded.status, 200);
  const parts = [{ partNumber: 1, etag: uploaded.headers.get('etag') }];
  const holdMs = 6500;
  let ready;
  const acquired = new Promise((resolve) => {
    ready = resolve;
  });
  const lock = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sekereagle:privacy:${ownerId}:${libraryMode}`}, 0))::text`;
      ready();
      await delay(holdMs);
    },
    { timeout: holdMs + 5000 },
  );
  await Promise.race([
    acquired,
    lock.then(() => {
      throw new Error('Lock probe exited before acquisition');
    }),
  ]);
  const acceptanceStarted = Date.now();
  // Both browser requests only accept one durable job; publication runs in the operations host.
  const completions = await Promise.all([
    post(`uploads/${sessionId}/complete`, { parts }),
    post(`uploads/${sessionId}/complete`, { parts }),
  ]);
  const acceptanceMs = Date.now() - acceptanceStarted;
  await lock;
  for (const response of completions) assert.ok([201, 202].includes(response.status));
  assert.ok(
    acceptanceMs < 2000,
    `accepting the upload waited ${acceptanceMs}ms on the privacy lock`,
  );
  assert.equal(
    await db.uploadFinalizationJob.count({ where: { uploadSessionId: sessionId } }),
    1,
    'concurrent completion must enqueue exactly one job',
  );
  const publicationStarted = Date.now();
  let id;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = await get(`uploads/${sessionId}`);
    if (state.body.status === 'COMPLETED' && state.body.eagleAssetId) {
      id = state.body.eagleAssetId;
      break;
    }
    if (state.body.status === 'FAILED' || state.body.status === 'ABORTED')
      throw new Error(state.body.lastError || 'upload publication failed');
    await delay(500);
  }
  assert.ok(id, 'the operations host did not publish the accepted upload');
  const publicationMs = Date.now() - publicationStarted;
  const repeated = await post(`uploads/${sessionId}/complete`, { parts });
  assert.ok([201, 202].includes(repeated.status));
  assert.equal(repeated.body.assetId, id);
  assert.equal(await db.eagleAsset.count({ where: { ownerId, libraryMode } }), countBefore + 1);
  const originalAfter = await db.eagleAsset.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(originalAfter.sha256, sourceBefore.sha256);
  assert.equal(originalAfter.rowVersion, sourceBefore.rowVersion);
  const copied = await db.eagleAsset.findUniqueOrThrow({ where: { id } });
  assert.equal(copied.ownerId, ownerId);
  assert.equal(copied.libraryMode, libraryMode);
  console.log(
    JSON.stringify({
      mode,
      uploadPublication: 'accepted-then-published',
      acceptanceMs,
      publicationMs,
      copies: 1,
      originalUnchanged: true,
    }),
  );
}
