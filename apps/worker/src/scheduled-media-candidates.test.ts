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
    for (let i = 0; i < 3; i++) await select(input('INTERACTIVE'));
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
