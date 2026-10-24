import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PatService } from './pat.service';

void test('新建 PAT 永久有效，同时保留最小权限和单次明文返回', async () => {
  let createdData: Record<string, unknown> | undefined;
  const prisma = {
    personalAccessToken: {
      create: (input: { data: Record<string, unknown> }) => {
        createdData = input.data;
        return Promise.resolve({
          id: 'pat-1',
          name: input.data.name,
          scopes: input.data.scopes,
          expiresAt: null,
          createdAt: new Date('2026-08-19T00:00:00.000Z'),
        });
      },
    },
  } as unknown as PrismaService;

  Object.assign(prisma, {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    $queryRaw: async () => [{ id: 'owner-1' }],
  });
  const result = await new PatService(prisma).create('owner-1', '采集器', [
    'capture:write',
    'capture:write',
  ]);

  assert.equal(createdData?.userId, 'owner-1');
  assert.equal(createdData?.expiresAt, null);
  assert.deepEqual(createdData?.scopes, ['capture:write']);
  assert.match(result.token, /^sea_pat_/);
  assert.notEqual(createdData?.tokenHash, result.token);
});

void test('永久 PAT 可认证并仍从令牌记录推导 owner 身份', async () => {
  const token = 'sea_pat_test-token';
  let lastUsedUpdated = false;
  const prisma = {
    personalAccessToken: {
      findUnique: () =>
        Promise.resolve({
          id: 'pat-1',
          tokenHash: 'stored-hash',
          name: '采集器',
          scopes: ['capture:write'],
          expiresAt: null,
          revokedAt: null,
          createdAt: new Date(),
          lastUsedAt: null,
          userId: 'owner-1',
          user: {
            id: 'owner-1',
            email: 'owner@example.com',
            role: UserRole.USER,
            authVersion: 2,
            disabledAt: null,
          },
        }),
      updateMany: () => {
        lastUsedUpdated = true;
        return Promise.resolve({});
      },
    },
  } as unknown as PrismaService;

  const principal = await new PatService(prisma).authenticate(token);

  assert.deepEqual(principal, {
    sub: 'owner-1',
    email: 'owner@example.com',
    role: UserRole.USER,
    authVersion: 2,
    kind: 'pat',
    scopes: ['capture:write'],
    canViewPrivate: false,
    privacyVisibleUntil: null,
  });
  assert.equal(lastUsedUpdated, true);
});

void test('永久 PAT 被撤销后仍然拒绝认证', async () => {
  let lastUsedUpdated = false;
  const prisma = {
    personalAccessToken: {
      findUnique: () =>
        Promise.resolve({
          id: 'pat-1',
          scopes: ['capture:write'],
          expiresAt: null,
          revokedAt: new Date(),
          user: { disabledAt: null },
        }),
      updateMany: () => {
        lastUsedUpdated = true;
        return Promise.resolve({});
      },
    },
  } as unknown as PrismaService;

  await assert.rejects(
    new PatService(prisma).authenticate('sea_pat_revoked-token'),
    /PAT 无效或已过期/,
  );
  assert.equal(lastUsedUpdated, false);
});

void test('PAT last-used tracking is bounded without weakening revocation checks', async () => {
  for (const lastUsedAt of [new Date(), new Date(Date.now() - 120_000), null]) {
    const writes: Array<{ where?: Record<string, unknown> }> = [];
    const record = {
      id: 'pat-1',
      userId: 'owner-1',
      scopes: ['capture:write'],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt,
      user: {
        id: 'owner-1',
        email: 'owner@example.invalid',
        role: UserRole.USER,
        authVersion: 1,
        disabledAt: null,
      },
    };
    const write = async (query: { where?: Record<string, unknown> }) => {
      writes.push(query);
      return { count: 1 };
    };
    const prisma = {
      personalAccessToken: { findUnique: async () => record, update: write, updateMany: write },
    } as unknown as PrismaService;
    const principal = await new PatService(prisma).authenticate('sea_pat_test-token');
    assert.equal(principal.sub, 'owner-1');
    if (lastUsedAt && Date.now() - lastUsedAt.getTime() < 60_000) assert.equal(writes.length, 0);
    else {
      assert.equal(writes.length, 1);
      assert.equal(writes[0]?.where?.userId, 'owner-1');
      assert.equal(writes[0]?.where?.revokedAt, null);
      assert.ok(Array.isArray(writes[0]?.where?.OR));
    }
  }
});

void test('PAT 自助撤销只匹配当前主体和令牌摘要，不撤销同账号其他令牌', async () => {
  let query: unknown;
  const prisma = {
    personalAccessToken: {
      updateMany: async (input: unknown) => {
        query = input;
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;
  await new PatService(prisma).revokeCurrent('owner-1', 'sea_pat_current');
  const { createHash } = await import('node:crypto');
  assert.deepEqual(query, {
    where: {
      userId: 'owner-1',
      tokenHash: createHash('sha256').update('sea_pat_current').digest('hex'),
      revokedAt: null,
    },
    data: { revokedAt: (query as { data: { revokedAt: Date } }).data.revokedAt },
  });
});

void test('账号停用或令牌过期时拒绝 PAT，且不更新使用记录', async () => {
  for (const state of [
    { disabledAt: new Date(), expiresAt: null },
    { disabledAt: null, expiresAt: new Date(Date.now() - 1000) },
  ]) {
    const prisma = {
      personalAccessToken: {
        findUnique: async () => ({
          revokedAt: null,
          expiresAt: state.expiresAt,
          user: { disabledAt: state.disabledAt },
        }),
        updateMany: async () => {
          assert.fail('rejected PAT must not be used');
        },
      },
    } as unknown as PrismaService;
    await assert.rejects(
      new PatService(prisma).authenticate('sea_pat_disabled'),
      /PAT 无效或已过期/,
    );
  }
});

void test('PAT 签发锁定当前账号版本，拒绝密码变更后的旧认证快照', async () => {
  let created = false;
  const prisma = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      $queryRaw: async (query: { sql: string; values: unknown[] }) => {
        assert.match(query.sql, /FOR SHARE/);
        assert.match(query.sql, /"authVersion"/);
        assert.match(query.sql, /"disabledAt" IS NULL/);
        assert.deepEqual(query.values, ['owner-1', 3]);
        return [];
      },
      personalAccessToken: { create: async () => { created = true; return {}; } },
    }),
  } as unknown as PrismaService;
  await assert.rejects(new PatService(prisma).create('owner-1', 'backup', ['asset:write'], 3), /登录状态已失效/);
  assert.equal(created, false);
});
