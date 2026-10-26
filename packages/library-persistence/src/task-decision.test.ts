import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { mediaTaskFactsSql, taskBackoffFactsSql, taskWaitReasonSql } from './task-decision';
test('SQL compiler uses the same ordered decision gates with bound values', () => {
  const query = taskWaitReasonSql({ paused: Prisma.sql`false`, modelOffline: Prisma.sql`true` });
  assert.ok(query.values.indexOf('PAUSED') < query.values.indexOf('MODEL_OFFLINE'));
  assert.ok(query.values.includes('QUEUED'));
});


test('media adapters share dependency and expiring backoff facts with bound error codes', () => {
  const facts = mediaTaskFactsSql(Prisma.sql`job`, Prisma.sql`dependency`);
  assert.match(facts.dependencyPending.sql, /dependsOnJobId/);
  assert.match(facts.dependencyFailed.sql, /COALESCE/);
  assert.match(facts.retryPending.sql, /availableAt/);
  const query = taskWaitReasonSql(facts);
  assert.ok(query.values.includes('DEPENDENCY_FAILED'));
  assert.ok(query.values.includes('MODEL_BUSY'));
  assert.ok(query.values.includes('WAITING_EMBEDDING_CAPACITY'));
  const expired = taskBackoffFactsSql(Prisma.sql`now()-interval '1 second'`, Prisma.sql`'WAITING_EMBEDDING_CAPACITY'`);
  assert.match(expired.modelBusy.sql, />now\(\)/);
});
