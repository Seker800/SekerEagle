import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Run only inside the guarded, disposable photo HTTP workbench. */
export async function verifyPeopleReviewHttp({ db, origin, accessToken, ownerId, assetIds }) {
  const call = (path, body, options = {}) =>
    fetch(`${origin}/api/photos/photography/people${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        cookie: `sekereagle_access=${accessToken}`,
        origin,
        'content-type': 'application/json',
        ...options.headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const people = [];
  for (let i = 0; i < 3; i++) {
    const prototype = [1, i * 0.1, ...Array(126).fill(0)];
    const p = await db.eaglePhotoPerson.create({
      data: {
        ownerId,
        modelVersion: 'http-review-v1',
        prototype,
        ...(i === 2 ? { name: '已命名示例' } : {}),
      },
    });
    const asset = await db.eagleAsset.findUniqueOrThrow({
      where: { id: assetIds[i % assetIds.length] },
    });
    await db.eaglePhotoFace.create({
      data: {
        id: randomUUID(),
        ownerId,
        assetId: asset.id,
        assetRevision: asset.mediaRevision,
        personId: p.id,
        embedding: prototype,
        modelVersion: p.modelVersion,
        confidence: 0.99,
        box: [0.2, 0.15, 0.3, 0.3],
      },
    });
    people.push(p);
  }
  const [first, second] = people;
  const input = {
    firstId: first.id,
    secondId: second.id,
    firstVersion: 1,
    secondVersion: 1,
    decision: 'DIFFERENT',
  };
  assert.equal((await call('/summary')).status, 200);
  assert.equal((await call('/review')).status, 200);
  assert.equal((await call('/review', input, { headers: { cookie: '' } })).status, 401);
  assert.equal(
    (await call('/review', input, { headers: { origin: 'https://invalid.example' } })).status,
    403,
  );
  assert.equal((await call('/review', { ...input, ownerId: randomUUID() })).status, 400);
  assert.equal((await call('/review', { ...input, secondId: randomUUID() })).status, 404);
  assert.equal((await call('/review', input)).status, 201);
  assert.equal((await call('/review', { ...input, decision: 'SAME' })).status, 409);
  assert.equal(
    (await call('/review', { ...input, firstVersion: 2, secondVersion: 2, decision: 'SAME' }))
      .status,
    201,
  );
  assert.equal(await db.eaglePhotoPerson.findUnique({ where: { id: first.id } }), null);
  return {
    passed: true,
    checks: [
      'authenticated browser',
      'origin guard',
      'no owner DTO',
      'foreign identity hidden',
      'persisted negative',
      'stale decision refused',
      'explicit merge',
    ],
  };
}
