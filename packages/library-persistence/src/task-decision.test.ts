import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma} from '@prisma/client';
import {taskWaitReasonSql} from './task-decision';
test('SQL compiler uses the same ordered decision gates with bound values', () => {
  const query = taskWaitReasonSql({paused: Prisma.sql`false`, modelOffline: Prisma.sql`true`});
  assert.ok(query.values.indexOf('PAUSED') < query.values.indexOf('MODEL_OFFLINE'));
  assert.ok(query.values.includes('QUEUED'));
});
