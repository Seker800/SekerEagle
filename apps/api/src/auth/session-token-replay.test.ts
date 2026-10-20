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
        user: { id: 'owner', disabledAt: null },
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
