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
  const request = async (path, body) => {
    const response = await fetch(`${origin}/api/${mode}/${path}`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const created = await request('uploads', {
    originalName: 'publication-lock-regression.png',
    mimeType: 'image/png',
    size: bytes.length,
    duplicatePolicy: 'CREATE_COPY',
    copySourceAssetId: source.id,
    copySourceRowVersion: source.rowVersion,
  });
  assert.equal(created.status, 201);
  const sessionId = created.body.id;
  const signed = await request(`uploads/${sessionId}/parts/1`, {});
  assert.equal(signed.status, 201);
  const uploaded = await fetch(signed.body.uploadUrl, { method: 'PUT', body: bytes });
  assert.equal(uploaded.status, 200);
  const parts = [{ partNumber: 1, etag: uploaded.headers.get('etag') }];
  const budget = Number(process.env.EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS ?? 30_000);
  const expectBusy = budget < 5000;
  const holdMs = expectBusy ? budget + 600 : 6500;
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
  const begun = Date.now();
  // Both browser requests must resolve to one atomic publication, including after contention.
  let completions;
  try {
    completions = await Promise.all([
      request(`uploads/${sessionId}/complete`, { parts }),
      request(`uploads/${sessionId}/complete`, { parts }),
    ]);
  } finally {
    await lock;
  }
  const elapsedMs = Date.now() - begun;
  if (expectBusy) {
    for (const response of completions) {
      assert.equal(response.status, 503);
      assert.equal(response.body.code, 'UPLOAD_PUBLICATION_BUSY');
      assert.ok(!JSON.stringify(response.body).includes('Prisma'));
    }
    const failed = await db.uploadSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.eagleAssetId, null);
    assert.equal(failed.objectCleanupPending, false);
    assert.equal(await db.eagleAsset.count({ where: { ownerId, libraryMode } }), countBefore);
    completions = [await request(`uploads/${sessionId}/complete`, { parts })];
  }
  for (const response of completions) assert.equal(response.status, 201);
  const id = completions[0].body.assetId;
  assert.ok(id && id !== source.id);
  assert.ok(completions.every((response) => response.body.assetId === id));
  const repeated = await request(`uploads/${sessionId}/complete`, { parts });
  assert.equal(repeated.status, 201);
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
      uploadPublication: expectBusy ? '503-rollback-and-retry' : 'contention-survived',
      elapsedMs,
      copies: 1,
      originalUnchanged: true,
    }),
  );
}
