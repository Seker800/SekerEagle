import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { isDatabaseBusy } from './database-errors';

test('database cancellation remains retryable across both Prisma metadata shapes', () => {
  for (const sqlCode of ['57014', '23505']) {
    for (const meta of [
      { code: sqlCode },
      { driverAdapterError: { cause: { originalCode: sqlCode, code: sqlCode, kind: 'postgres' } } },
    ]) {
      const error = new Prisma.PrismaClientKnownRequestError('synthetic', {
        code: 'P2010',
        clientVersion: '7.10.1',
        meta,
      });
      assert.equal(isDatabaseBusy(error), sqlCode === '57014');
    }
  }
  for (const code of ['P2028', 'P2024', 'P2034']) {
    assert(
      isDatabaseBusy(
        new Prisma.PrismaClientKnownRequestError('synthetic', { code, clientVersion: '7.10.1' }),
      ),
    );
  }
  for (const error of [
    null,
    new Error('57014'),
    { code: 'P2010' },
    new Prisma.PrismaClientKnownRequestError('synthetic', {
      code: 'P2010',
      clientVersion: '7.10.1',
      meta: { driverAdapterError: null },
    }),
  ]) {
    assert.equal(isDatabaseBusy(error), false);
  }
});
