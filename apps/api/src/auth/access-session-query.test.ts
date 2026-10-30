import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionTokenService } from './session-token.service';

test('access verification checks current account and active family in one database query without caching', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let active = true;
  const db = {
    user: {
      findUnique: async () => assert.fail('separate user and family queries must be combined'),
      findFirst: async (query: Record<string, unknown>) => {
        calls.push(query);
        return active
          ? { id: 'owner', email: 'owner@example.invalid', role: 'USER', authVersion: 7 }
          : null;
      },
    },
  };
  const service = new SessionTokenService(
    db as never,
    {
      verifyAsync: async () => ({
        sub: 'owner',
        kind: 'browser',
        authVersion: 7,
        sessionFamilyId: 'family',
      }),
    } as never,
    {} as never,
  );
  assert.equal((await service.verifyAccessToken('synthetic')).sub, 'owner');
  const where = calls[0]!.where as Record<string, unknown>;
  const family = (where.refreshTokens as { some: Record<string, unknown> }).some;
  assert.equal(where.id, 'owner');
  assert.equal(where.disabledAt, null);
  assert.equal(where.authVersion, 7);
  assert.equal(family.familyId, 'family');
  assert.equal(family.revokedAt, null);
  assert.ok((family.expiresAt as { gt: Date }).gt instanceof Date);
  active = false;
  await assert.rejects(service.verifyAccessToken('synthetic'), /登录状态已失效/);
  assert.equal(calls.length, 2, 'revocation must be checked again on the very next request');
});

test('malformed signed account or family identifiers fail closed before any query', async () => {
  for (const identifiers of [
    { sub: undefined, sessionFamilyId: 'family' },
    { sub: '', sessionFamilyId: 'family' },
    { sub: {}, sessionFamilyId: 'family' },
    { sub: 'owner', sessionFamilyId: {} },
    { sub: 'owner', sessionFamilyId: '' },
  ]) {
    const service = new SessionTokenService(
      {} as never,
      {
        verifyAsync: async () => ({ kind: 'browser', authVersion: 7, ...identifiers }),
      } as never,
      {} as never,
    );
    await assert.rejects(service.verifyAccessToken('synthetic'), /访问令牌类型无效/);
  }
});
