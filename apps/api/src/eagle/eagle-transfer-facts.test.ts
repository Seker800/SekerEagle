import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTransferFacts, resolveTransferTagMappings } from './eagle-transfer-facts';

test('a transferred vector is preserved off-index and schedules normal background activation', async () => {
  let vectorSql = '';
  const result = await copyTransferFacts(
    {
      eagleAssetTransferFacts: { create: async () => ({}) },
      $queryRaw: async (sql: { sql: string }) => {
        vectorSql = sql.sql;
        return [{ id: 'pending-vector' }];
      },
      $executeRaw: async () => {
        throw new Error('SEND must not match smart folders or write the HNSW index');
      },
    } as never,
    'owner',
    'MATERIAL',
    'target',
    { id: 'source', libraryMode: 'PHOTO', mediaRevision: 1 } as never,
    true,
  );
  assert.match(vectorSql, /'PENDING',false/);
  assert.equal(
    result.embeddingReady,
    false,
    'the existing embedding job must activate the copied vector',
  );
});


test('100 shared source tags resolve once and retain assignment provenance in each target', async () => {
  const calls = { reads: 0, groups: 0, tags: 0, memberships: 0 };
  const links: unknown[] = [];
  const source = { id: 'source', libraryMode: 'PHOTO', mediaRevision: 1, manualTagLinks: [{
    assignedByUser: false, assignmentProvenance: 'EAGLE_IMPORTED',
    tag: { id: 'tag', name: 'Shared', normalizedName: 'shared', marksAssetsPrivate: false,
      groupId: 'group', group: { id: 'group', name: 'Group', normalizedName: 'group' },
      groupMemberships: [{ group: { id: 'other', name: 'Other', normalizedName: 'other' } }] },
  }] };
  let savedTags: unknown[] = [];
  const tx = {
    eagleManualTag: {
      findMany: async () => { calls.reads++; return savedTags; },
      createMany: async ({ data }: { data: unknown[] }) => { calls.tags++; savedTags = data.map((tag: unknown) => ({ ...(tag as object), id: 'target-tag' })); },
    },
    eagleManualTagGroup: {
      createMany: async () => { calls.groups++; },
      findMany: async () => [{ id: 'target-group', normalizedName: 'group' }, { id: 'target-other', normalizedName: 'other' }],
    },
    eagleManualTagGroupMembership: { createMany: async ({ data }: { data: unknown[] }) => { calls.memberships += data.length; } },
    eagleAssetManualTag: { createMany: async ({ data }: { data: unknown[] }) => { links.push(...data); } },
    eagleAssetTransferFacts: { create: async () => ({}) },
    $queryRaw: async () => [],
  };
  const mappings = await resolveTransferTagMappings(tx as never, { ownerId: 'owner', targetMode: 'MATERIAL' }, Array.from({ length: 100 }, () => source) as never);
  for (let index = 0; index < 100; index++)
    await copyTransferFacts(tx as never, 'owner', 'MATERIAL', `target-${index}`, source as never, true, mappings);
  assert.deepEqual(calls, { reads: 2, groups: 1, tags: 1, memberships: 2 });
  assert.equal(links.length, 100);
  assert.deepEqual(links[0], { ownerId: 'owner', libraryMode: 'MATERIAL', assetId: 'target-0', tagId: 'target-tag', assignedByUser: false, assignmentProvenance: 'EAGLE_IMPORTED' });
});
