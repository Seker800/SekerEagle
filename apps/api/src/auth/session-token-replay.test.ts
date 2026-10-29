import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { SessionTokenService } from './session-token.service';

for (const preRevoked of [true, false])
  test(`refresh reuse revokes the family durably, including a rotation race: ${preRevoked}`, async () => {
    const rows = [
      {
        id: 'old',
        userId: 'owner',
        familyId: 'family',
        tokenHash: createHash('sha256').update('old-token').digest('hex'),
        revokedAt: preRevoked ? new Date() : null,
        expiresAt: new Date(Date.now() + 60000),
        authVersion: 0,
        user: { id: 'owner', disabledAt: null, authVersion: 0 },
      },
      { id: 'replacement', userId: 'owner', familyId: 'family', revokedAt: null },
      { id: 'other-device', userId: 'owner', familyId: 'other-family', revokedAt: null },
    ];
    const db = {
      refreshToken: {
        findUnique: async () => ({ ...rows[0] }),
        updateMany: async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: { revokedAt: Date };
        }) => {
          if (where.id) return { count: 0 }; // Another request rotated before this lock.
          let count = 0;
          for (const r of rows)
            if (r.familyId === where.familyId && r.userId === where.userId && !r.revokedAt) {
              r.revokedAt = data.revokedAt;
              count++;
            }
          return { count };
        },
      },
      $queryRaw: async () => [{ id: 'owner' }],
      $executeRaw: async () => 1,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const before = rows.map((r) => r.revokedAt);
        try {
          return await fn(db);
        } catch (e) {
          rows.forEach((r, i) => {
            r.revokedAt = before[i] ?? null;
          });
          throw e;
        }
      },
    };
    const service = new SessionTokenService(db as never, {} as never, {} as never);
    await assert.rejects(() => service.refreshSession('old-token'));
    assert.ok(rows[1]!.revokedAt, 'revocation must commit, not roll back with the rejection');
    assert.equal(rows[2]!.revokedAt, null, 'other device family remains active');
  });

test('refresh cannot upgrade an old password session to a new auth version', async () => {
  let issued = false;
  const stored = {
    id: 'old',
    userId: 'owner',
    familyId: 'family',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60000),
    authVersion: 2,
    user: { id: 'owner', disabledAt: null, authVersion: 3 },
  };
  const db = {
    refreshToken: {
      findUnique: async () => stored,
      updateMany: async () => ({ count: 1 }),
      create: async () => {
        issued = true;
      },
    },
    $executeRaw: async () => 1,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = new SessionTokenService(
    db as never,
    { signAsync: async () => 'access' } as never,
    { getOrThrow: () => 900 } as never,
  );
  await assert.rejects(service.refreshSession('old-password-refresh'), /登录状态已失效/);
  assert.equal(issued, false);
});

test('login rejects a stale account snapshot before creating a dead refresh row', async () => {
  let issued = false;
  const db = {
    $queryRaw: async () => [],
    refreshToken: {
      create: async () => {
        issued = true;
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = new SessionTokenService(
    db as never,
    { signAsync: async () => 'access' } as never,
    { getOrThrow: () => 900 } as never,
  );
  await assert.rejects(
    service.createSession({ id: 'owner', authVersion: 1, disabledAt: null } as never),
    /登录状态已失效/,
  );
  assert.equal(issued, false);
});

test('refresh locks and rechecks the account before family and token rows, including a version change while waiting', async () => {
  for (const accountStillCurrent of [true, false]) {
    const order: string[] = [];
    const db = {
      $queryRaw: async (query: { sql: string; values: unknown[] }) => {
        order.push('account');
        assert.match(query.sql, /FOR SHARE/);
        assert.match(query.sql, /"authVersion"/);
        assert.match(query.sql, /"disabledAt" IS NULL/);
        assert.deepEqual(query.values, ['owner', 4]);
        return accountStillCurrent ? [{ id: 'owner' }] : [];
      },
      $executeRaw: async () => {
        order.push('family');
        return 1;
      },
      refreshToken: {
        findUnique: async () => ({
          id: 'old',
          userId: 'owner',
          familyId: 'family',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60000),
          authVersion: 4,
          user: { id: 'owner', authVersion: 4, disabledAt: null },
        }),
        updateMany: async () => {
          order.push('rotate');
          return { count: 1 };
        },
        create: async () => {
          order.push('issue');
        },
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    };
    const service = new SessionTokenService(
      db as never,
      { signAsync: async () => 'access' } as never,
      { getOrThrow: () => 900 } as never,
    );
    if (accountStillCurrent) {
      assert.equal((await service.refreshSession('refresh')).accessToken, 'access');
      assert.deepEqual(order, ['account', 'family', 'rotate', 'issue']);
    } else {
      await assert.rejects(service.refreshSession('refresh'), /登录状态已失效/);
      assert.deepEqual(order, ['account']);
    }
  }
});

test('logout with the pre-rotation proof revokes replacement tokens in the same family only', async () => {
  let revoked: Record<string, unknown> | undefined;
  const order: string[] = [];
  const db = {
    refreshToken: {
      findUnique: async () => ({ userId: 'owner', familyId: 'family', revokedAt: new Date() }),
      updateMany: async (input: { where: Record<string, unknown> }) => {
        order.push('revoke');
        revoked = input.where;
        return { count: 1 };
      },
    },
    $executeRaw: async () => {
      order.push('family-lock');
      return 1;
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  await new SessionTokenService(db as never, {} as never, {} as never).revoke('old-proof');
  assert.deepEqual(order, ['family-lock', 'revoke']);
  assert.deepEqual(revoked, { userId: 'owner', familyId: 'family', revokedAt: null });
});

test('access validation uses one live scoped statement without retaining revocation facts', async () => {
  const queries: Array<{sql:string;values:unknown[]}> = [];
  let active = true;
  const principal = {id:'owner',email:'owner@example.invalid',role:'USER',authVersion:2};
  const service = new SessionTokenService({$queryRaw: async (query: {sql:string;values:unknown[]}) => {
    queries.push(query); return active ? [principal] : [];
  }} as never, {verifyAsync: async () => ({sub:'owner',kind:'browser',authVersion:2,sessionFamilyId:'family'})} as never, {} as never);
  assert.equal((await service.verifyAccessToken('synthetic')).sub,'owner');
  active = false;
  await assert.rejects(service.verifyAccessToken('synthetic'), /登录状态已失效/);
  assert.equal(queries.length,2);
  for (const query of queries) {
    assert.match(query.sql,/EXISTS/);
    assert.match(query.sql,/"revokedAt" IS NULL/);
    assert.match(query.sql,/"disabledAt" IS NULL/);
    assert.match(query.sql,/"expiresAt">/);
    assert.ok(query.values.includes('owner'));
    assert.ok(query.values.includes('family'));
    assert.ok(query.values.includes(2));
  }
});
