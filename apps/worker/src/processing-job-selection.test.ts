import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProcessingJobKinds } from './processing-policy';
import { claimNextMediaJob } from './job-claim';

test('explicit processing profile is strict, deduplicated and leaves the default unchanged', () => {
  assert.equal(parseProcessingJobKinds(undefined), undefined);
  assert.deepEqual(
    parseProcessingJobKinds(' GENERATE_RENDITIONS,GENERATE_EMBEDDING,GENERATE_RENDITIONS '),
    ['GENERATE_RENDITIONS', 'GENERATE_EMBEDDING'],
  );
  for (const value of ['', ' ', 'GENERATE_EMBEDING', 'GENERATE_EMBEDDING,', 'constructor'])
    assert.throws(() => parseProcessingJobKinds(value), /EAGLE_PROCESSING_JOB_KINDS/);
});

test('the database query excludes paused job kinds before the bounded candidate window', async () => {
  const queries: Array<{ where: { kind?: unknown } }> = [];
  const client = {
    eagleAssetProcessingJob: {
      findMany: async (query: { where: { kind?: unknown } }) => {
        queries.push(query);
        return [];
      },
      updateMany: async () => {
        throw Error('No candidate may be claimed');
      },
      findUniqueOrThrow: async () => {
        throw Error('No candidate may be read');
      },
    },
  };
  const allowedJobKinds = ['GENERATE_RENDITIONS', 'GENERATE_EMBEDDING'] as const;
  await claimNextMediaJob(client, { allowedJobKinds, canClaimBackground: async () => true });
  assert.equal(queries.length, 3);
  assert.deepEqual(
    queries.map((q) => q.where.kind),
    [
      { in: [...allowedJobKinds] },
      { not: 'GENERATE_AI_TAGS', in: [...allowedJobKinds] },
      { in: [...allowedJobKinds] },
    ],
  );
});

test('AI tag partition remains available only when explicitly allowed', async () => {
  const kinds: unknown[] = [];
  await claimNextMediaJob(
    {
      eagleAssetProcessingJob: {
        findMany: async (q) => {
          kinds.push(q.where.kind);
          return [];
        },
        updateMany: async () => ({ count: 0 }),
        findUniqueOrThrow: async () => {
          throw Error('No candidate');
        },
      },
    },
    { allowedJobKinds: ['GENERATE_AI_TAGS'], canClaimBackground: async () => true },
  );
  assert.ok(kinds.includes('GENERATE_AI_TAGS'));
});

test('wake-up queries use the same selection and group every selected job version', async () => {
  const { buildMediaWakeQuery } = await import('./job-wakeup-query');
  const query = buildMediaWakeQuery(['GENERATE_RENDITIONS','GENERATE_EMBEDDING']);
  assert.match(query.sql, /WHERE candidate.kind IN/);
  assert.deepEqual(query.values, ['GENERATE_RENDITIONS','GENERATE_EMBEDDING']);
  assert.match(query.sql, /GROUP BY[^;]*candidate\."processorVersion"/);
  assert.doesNotMatch(buildMediaWakeQuery().sql, /WHERE candidate.kind IN/);
  assert.match(buildMediaWakeQuery([]).sql, /WHERE false/);
});
