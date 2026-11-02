import assert from 'node:assert/strict';
import test from 'node:test';
import { databasePoolConfig, createPrismaAdapter } from './database-adapter';

test('database adapter preserves explicit pool and connection budgets', () => {
  const config = databasePoolConfig(
    'postgresql://test@127.0.0.1/sekereagle_test?connection_limit=7&connect_timeout=3',
  );
  assert.equal(config.max, 7);
  assert.equal(config.connectionTimeoutMillis, 3000);
  assert.equal(config.idleTimeoutMillis, 300000);
  assert.equal(createPrismaAdapter(config.connectionString).provider, 'postgres');
});

test('database adapter fails closed for external systems and malformed limits', () => {
  for (const url of [
    'postgresql://test@192.168.31.89/sekereagle',
    'postgresql://test@localhost/sekerchat',
    'postgresql://test@unknown/sekereagle',
    'postgresql://test@localhost/sekereagle?connection_limit=0',
    'postgresql://test@localhost/sekereagle?connect_timeout=NaN',
  ])
    assert.throws(() => databasePoolConfig(url));
});
