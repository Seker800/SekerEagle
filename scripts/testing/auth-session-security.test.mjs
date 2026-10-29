import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { test, after } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { SessionTokenService } from '../../apps/api/dist/auth/session-token.service.js';
import { PasswordService } from '../../apps/api/dist/auth/password.service.js';
import { PhotoManagementService } from '../../apps/api/dist/photos/photo-management.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
after(() => prisma.$disconnect());
const jwt = new JwtService({
  secret: 'synthetic-integration-signing-secret-32-bytes',
  signOptions: { expiresIn: 900 },
});
const config = { getOrThrow: () => 3600 };

test('real database rejects login/refresh credentials created from a stale pre-change account snapshot', async () => {
  const passwords = new PasswordService(prisma);
  const user = await passwords.createUser(
    `${randomUUID()}@example.invalid`,
    'original-password-123',
    'USER',
  );
  const sessions = new SessionTokenService(prisma, jwt, config);
  try {
    const previous = await sessions.createSession(user);
    await passwords.resetPassword(user.id, 'replacement-password-456');
    // A login that already verified the old password resumes after the reset commits.
    const count = await prisma.refreshToken.count({ where: { userId: user.id } });
    await assert.rejects(sessions.createSession(user), /登录状态已失效/);
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), count);
    await assert.rejects(sessions.verifyAccessToken(previous.accessToken));
    await assert.rejects(sessions.refreshSession(previous.refreshToken));
    const current = await passwords.login(user.email, 'replacement-password-456');
    const valid = await sessions.createSession(current);
    assert.equal((await sessions.verifyAccessToken(valid.accessToken)).sub, user.id);
    const rotated = await sessions.refreshSession(valid.refreshToken);
    assert.equal((await sessions.verifyAccessToken(rotated.accessToken)).sub, user.id);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('people paging visits all 205 records with privacy scope and survives removal of the last cursor record', async () => {
  const ownerId = randomUUID();
  const otherId = randomUUID();
  await prisma.user.createMany({
    data: [ownerId, otherId].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'synthetic-only',
    })),
  });
  try {
    await prisma.eaglePhotoPerson.createMany({
      data: [
        ...Array.from({ length: 205 }, () => ({
          id: randomUUID(),
          ownerId,
          marksAssetsPrivate: true,
          libraryMode: 'PHOTO',
          modelVersion: 'synthetic-pagination-test',
          prototype: [],
        })),
        {
          id: randomUUID(),
          ownerId: otherId,
          marksAssetsPrivate: true,
          libraryMode: 'PHOTO',
          modelVersion: 'synthetic-pagination-test',
          prototype: [],
        },
      ],
    });
    const people = new PhotoManagementService(prisma);
    assert.equal((await people.people(ownerId, false)).people.length, 0);
    const first = await people.people(ownerId, true);
    assert.equal(first.people.length, 200);
    assert.ok(first.nextCursor);
    await prisma.eaglePhotoPerson.delete({
      where: { id: JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()).id },
    });
    const last = await people.people(ownerId, true, first.nextCursor);
    assert.equal(last.people.length, 5);
    assert.equal(last.nextCursor, null);
    const insertedId = '00000000-0000-4000-8000-000000000001';
    await prisma.eaglePhotoPerson.create({
      data: {
        id: insertedId,
        ownerId,
        libraryMode: 'PHOTO',
        marksAssetsPrivate: true,
        modelVersion: 'synthetic-pagination-test',
        prototype: [],
        createdAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
    const withInserted = await people.people(ownerId, true, first.nextCursor);
    assert.equal(withInserted.people.length, 6);
    assert.equal(withInserted.people.at(-1).id, insertedId);
    await assert.rejects(people.people(otherId, true, first.nextCursor));
    await assert.rejects(people.people(ownerId, false, first.nextCursor));
    assert.equal(new Set([...first.people, ...last.people].map((person) => person.id)).size, 205);
  } finally {
    await prisma.eaglePhotoPerson.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  }
});

test('historical refresh migration revokes unverifiable legacy sessions and permits fresh sign-in', async () => {
  const stored = await prisma.refreshToken.findUniqueOrThrow({
    where: { id: 'legacy-auth-token' },
  });
  assert.equal(stored.authVersion, 7);
  assert.ok(
    stored.revokedAt,
    'legacy rows have no trustworthy issuance version and must not be legitimized',
  );
  const sessions = new SessionTokenService(prisma, jwt, config);
  await assert.rejects(sessions.refreshSession('synthetic-legacy-refresh'));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: 'legacy-auth-owner' } });
  const fresh = await sessions.createSession(user);
  const refreshed = await sessions.refreshSession(fresh.refreshToken);
  assert.equal((await sessions.verifyAccessToken(refreshed.accessToken)).sub, 'legacy-auth-owner');
});

test('concurrent account reset holds the row before either login or refresh can issue credentials', async () => {
  const passwords = new PasswordService(prisma);
  const user = await passwords.createUser(
    `${randomUUID()}@example.invalid`,
    'original-password-123',
    'USER',
  );
  const sessions = new SessionTokenService(prisma, jwt, config);
  const prior = await sessions.createSession(user);
  let release;
  let locked;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    locked = resolve;
  });
  const reset = prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    locked();
    await gate;
  });
  try {
    await ready;
    let settled = false;
    const login = assert.rejects(sessions.createSession(user), /登录状态已失效/).then(() => {
      settled = true;
    });
    const refresh = assert.rejects(sessions.refreshSession(prior.refreshToken));
    await delay(50);
    assert.equal(settled, false, 'issuance must wait for the account row lock');
    release();
    await Promise.all([reset, login, refresh]);
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1);
    assert.equal(
      await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }),
      0,
    );
  } finally {
    release();
    await reset;
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('live access validation immediately honors family revocation, expiry, account disable and owner isolation', async () => {
  const passwords = new PasswordService(prisma);
  const user = await passwords.createUser(
    `${randomUUID()}@example.invalid`,
    'synthetic-password-123',
    'USER',
  );
  const other = await passwords.createUser(
    `${randomUUID()}@example.invalid`,
    'synthetic-password-456',
    'USER',
  );
  const sessions = new SessionTokenService(prisma, jwt, config);
  const family = randomUUID();
  try {
    const first = await sessions.createSession(user, family);
    await sessions.createSession(other, family);
    assert.equal((await sessions.verifyAccessToken(first.accessToken)).sub, user.id);
    await sessions.revoke(first.refreshToken);
    await assert.rejects(sessions.verifyAccessToken(first.accessToken));
    const fresh = await sessions.createSession(user);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { expiresAt: new Date(0) },
    });
    await assert.rejects(sessions.verifyAccessToken(fresh.accessToken));
    const enabled = await sessions.createSession(user);
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    await assert.rejects(sessions.verifyAccessToken(enabled.accessToken));
    await prisma.user.update({
      where: { id: user.id },
      data: { disabledAt: null, authVersion: { increment: 1 } },
    });
    await assert.rejects(sessions.verifyAccessToken(enabled.accessToken));
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  }
});
