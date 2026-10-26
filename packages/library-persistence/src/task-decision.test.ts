import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { MEDIA_LEASE_MS } from '@sekereagle/library-core';
import {
  mediaTaskFactsSql,
  taskBackoffFactsSql,
  taskWaitReasonSql,
  taskRunnableSql,
  backgroundFamilySql,
  mediaStaleBeforeSql,
  mediaBlocksAssetReadySql,
} from './task-decision';
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
  const expired = taskBackoffFactsSql(
    Prisma.sql`now()-interval '1 second'`,
    Prisma.sql`'WAITING_EMBEDDING_CAPACITY'`,
  );
  assert.match(expired.modelBusy.sql, />now\(\)/);
});

test('empty facts are runnable and optional capacity hints do not invent a wait', () => {
  assert.equal(taskRunnableSql({}).sql, 'true');
  assert.equal(taskWaitReasonSql({}).sql, "'QUEUED'");
  assert.equal(taskBackoffFactsSql(Prisma.sql`now()`).modelBusy.sql, 'false');
  const query = taskRunnableSql({ paused: Prisma.sql`true`, retryPending: Prisma.sql`false` });
  assert.match(query.sql, /NOT \(true\) AND NOT \(false\)/);
});

test('SQL adapters retain common background families, lease cutoff and browsing exclusions', () => {
  const background = backgroundFamilySql(Prisma.sql`family`);
  assert.ok(background.values.includes('EMBEDDING'));
  assert.ok(!background.values.includes('BROWSE'));
  assert.ok(!background.values.includes('UPLOADS'));
  assert.deepEqual(mediaStaleBeforeSql().values, [MEDIA_LEASE_MS]);
  const blocking = mediaBlocksAssetReadySql(Prisma.sql`kind`, Prisma.sql`version`);
  assert.ok(blocking.values.includes('GENERATE_RENDITIONS'));
  // Edited copies must not turn their original source into failed/processing browsing.
  assert.ok(!blocking.values.includes('RENDER_EDITED_COPY'));
});
