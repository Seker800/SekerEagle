import assert from 'node:assert/strict';
import test from 'node:test';
import { createScheduledMediaSelector } from './scheduled-media-candidates';
import type { ClaimFindManyInput } from './job-claim';

test('FIFO fairness belongs to each lane, so reserved background turns still use automatic preferences', async () => {
  const queries: string[] = [];
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        queries.push(sql.text);
        return [];
      },
    } as never,
    () => false,
  );
  const input = (lane: 'INTERACTIVE' | 'BACKGROUND') =>
    ({ where: { lane }, take: 50 }) as ClaimFindManyInput;
  for (let turn = 0; turn < 4; turn++) {
    for (let i = 0; i < 3; i++) {
      select.invalidate();
      await select(input('INTERACTIVE'));
    }
    select.invalidate();
    await select(input('BACKGROUND'));
  }
  const background = queries
    .filter((sql) => sql.includes('SELECT job.*'))
    .filter((_, index) => index % 4 === 3);
  assert.equal(background.length, 4);
  for (const sql of background.slice(0, 3)) assert.match(sql, /DESC,\s+CASE CASE WHEN/);
  assert.doesNotMatch(background[3]!, /DESC,\s+CASE CASE WHEN/);
  assert.ok(queries.every((sql) => !sql.includes('policy.priority')));
});

test('replacement freshness uses only the completed upload of the current owned media object', async () => {
  let query = '';
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        query = sql.text;
        return [];
      },
    } as never,
    () => false,
  );
  await select({ where: { lane: 'INTERACTIVE' }, take: 50 } as ClaimFindManyInput, 'RECENT');
  assert.match(query, /JOIN "UploadSession" current_upload/);
  assert.match(query, /current_upload\."objectKey"=a\."originalObjectKey"/);
  assert.match(query, /current_upload\."uploaderId"=a\."ownerId"/);
  assert.match(query, /current_upload\."libraryMode"=a\."libraryMode"/);
  assert.match(query, /current_upload\.status='COMPLETED'/);
  assert.match(
    query,
    /GREATEST\(a\."libraryAddedAt",COALESCE\(current_upload\."completedAt",a\."libraryAddedAt"\)\)/,
  );
  assert.doesNotMatch(query, /job\."createdAt">=/);
});

test('reuses a candidate window while revalidating its IDs before every claim', async () => {
  const queries: string[] = [];
  const select = createScheduledMediaSelector(
    {
      $queryRaw: async (sql: { text: string }) => {
        queries.push(sql.text);
        return [{ id: 'job-1' }];
      },
    } as never,
    () => false,
    'EMBEDDING',
  );
  const input = { where: { lane: 'BACKGROUND' }, take: 50 } as ClaimFindManyInput;
  await select(input, 'HISTORY');
  await select(input, 'HISTORY');
  assert.equal(
    queries.filter((sql) => !sql.includes('job.id IN')).length,
    1,
    'a second claim must not scan the whole backlog again',
  );
  assert.ok(
    queries.some((sql) => sql.includes('job.id IN')),
    'cached hints must be revalidated',
  );
});
