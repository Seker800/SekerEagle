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
      update: () => {
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
      update: () => {
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
