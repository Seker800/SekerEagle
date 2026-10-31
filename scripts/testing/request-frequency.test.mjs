import console from 'node:console';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const origin = process.env.REQUEST_FREQUENCY_TEST_ORIGIN;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const db = new PrismaClient();
const otherOwnerId = randomUUID();
const ownerId = randomUUID(),
  email = `frequency-${ownerId}@example.invalid`,
  password = randomUUID();
const browserOrigin = process.env.CANONICAL_ORIGIN;
let reads = 0,
  mediaReads = 0;
try {
  await db.user.create({
    data: { id: ownerId, email, passwordHash: await bcrypt.hash(password, 4) },
  });
  await db.user.create({
    data: {
      id: otherOwnerId,
      email: `frequency-other-${otherOwnerId}@example.invalid`,
      passwordHash: 'synthetic-only',
    },
  });
  let cookie = '';
  // Real successful logins must not hit the former fixed five-per-minute quota.
  for (let i = 0; i < 12; i++) {
    const response = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: browserOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 201, `login ${i + 1} must authenticate rather than hit a quota`);
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    await response.arrayBuffer();
  }
  const missing = randomUUID();
  const check = async (path, status, init = {}) => {
    const response = await fetch(`${origin}${path}`, {
      ...init,
      headers: { cookie, Origin: browserOrigin, ...init.headers },
    });
    assert.equal(response.status, status, path);
    assert.equal(response.headers.get('retry-after'), null, path);
    assert.equal(response.headers.get('x-ratelimit-limit'), null, path);
    await response.arrayBuffer();
  };
  const burst = async (path, status, count) => {
    // Bound test sockets; the application imposes no requests-per-time quota.
    for (let i = 0; i < count; i += 16)
      await Promise.all(Array.from({ length: Math.min(16, count - i) }, () => check(path, status)));
  };
  for (const mode of ['eagle', 'photos']) {
    const foreign = await db.eagleAsset.create({
      data: {
        id: randomUUID(),
        ownerId: otherOwnerId,
        libraryMode: mode === 'photos' ? 'PHOTO' : 'MATERIAL',
        originalName: 'synthetic.jpg',
        displayName: 'synthetic',
        normalizedDisplayName: 'synthetic',
        format: 'jpeg',
        mimeType: 'image/jpeg',
        byteSize: 1n,
        originalObjectKey: `users/${otherOwnerId}/assets/${randomUUID()}/original.jpg`,
        lifecycleStatus: 'READY',
      },
    });
    await check(`/api/${mode}/assets/${foreign.id}`, 404);
    await check(`/api/${mode}/operations`, 400, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerId: otherOwnerId,
        operationId: randomUUID(),
        kind: 'TRASH',
        assetIds: [foreign.id],
      }),
    });

    for (const path of [`/api/${mode}/assets?limit=40`, `/api/${mode}/smart-folders`]) {
      await burst(path, 200, 160);
      reads += 160;
    }
    await burst(`/api/${mode}/assets/${missing}/renditions/${missing}/content`, 404, 300);
    mediaReads += 300;
    await burst(`/api/${mode}/assets/${missing}/original`, 404, 16);
    await check(`/api/${mode}/uploads/check-content`, 201, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentSha256: 'a'.repeat(64), size: 1 }),
    });
    const unauthorized = await fetch(`${origin}/api/${mode}/assets?limit=40`);
    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();
    const badOrigin = await fetch(`${origin}/api/${mode}/operations`, {
      method: 'POST',
      headers: {
        cookie,
        Origin: 'https://untrusted.example.invalid',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operationId: randomUUID(), kind: 'TRASH', assetIds: [missing] }),
    });
    assert.equal(badOrigin.status, 403);
    await badOrigin.arrayBuffer();
  }
  await burst('/api/auth/me', 200, 160);
  reads += 160;
} finally {
  try {
    await db.eagleAsset.deleteMany({
      where: { ownerId: otherOwnerId, libraryMode: { in: ['MATERIAL', 'PHOTO'] } },
    });
    await db.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
  } finally {
    await db.$disconnect();
  }
}
console.log(
  JSON.stringify({
    test: 'request-frequency',
    successfulLogins: 12,
    authenticatedReads: reads,
    authenticatedMediaReads: mediaReads,
    no429: true,
    unauthenticated: 401,
    untrustedOrigin: 403,
    missingResource: 404,
    crossOwner: 404,
    ownerSpoof: 400,
  }),
);
