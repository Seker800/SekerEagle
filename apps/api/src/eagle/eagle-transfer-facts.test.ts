import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copyTransferFacts,
  resolveTransferTagMappings,
  flushTransferTagAssignments,
} from './eagle-transfer-facts';

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
  const source = {
    id: 'source',
    libraryMode: 'PHOTO',
    mediaRevision: 1,
    manualTagLinks: [
      {
        assignedByUser: false,
        assignmentProvenance: 'EAGLE_IMPORTED',
        tag: {
          id: 'tag',
          name: 'Shared',
          normalizedName: 'shared',
          marksAssetsPrivate: false,
          groupId: 'group',
          group: { id: 'group', name: 'Group', normalizedName: 'group' },
          groupMemberships: [{ group: { id: 'other', name: 'Other', normalizedName: 'other' } }],
        },
      },
    ],
  };
  let savedTags: unknown[] = [];
  const tx = {
    eagleManualTag: {
      findMany: async () => {
        calls.reads++;
        return savedTags;
      },
      createMany: async ({ data }: { data: unknown[] }) => {
        calls.tags++;
        savedTags = data.map((tag: unknown) => ({ ...(tag as object), id: 'target-tag' }));
      },
    },
    eagleManualTagGroup: {
      createMany: async () => {
        calls.groups++;
      },
      findMany: async () => [
        { id: 'target-group', normalizedName: 'group' },
        { id: 'target-other', normalizedName: 'other' },
      ],
    },
    eagleManualTagGroupMembership: {
      createMany: async ({ data }: { data: unknown[] }) => {
        calls.memberships += data.length;
      },
    },
    eagleAssetManualTag: {
      createMany: async ({ data }: { data: unknown[] }) => {
        links.push(...data);
      },
    },
    eagleAssetTransferFacts: { create: async () => ({}) },
    $queryRaw: async () => [],
  };
  const mappings = await resolveTransferTagMappings(
    tx as never,
    { ownerId: 'owner', targetMode: 'MATERIAL' },
    Array.from({ length: 100 }, () => source) as never,
  );
  for (let index = 0; index < 100; index++)
    await copyTransferFacts(
      tx as never,
      'owner',
      'MATERIAL',
      `target-${index}`,
      source as never,
      true,
      mappings,
    );
  assert.equal(links.length, 0, 'batch associations wait for all target rows before publication');
  await flushTransferTagAssignments(mappings);
  assert.deepEqual(calls, { reads: 2, groups: 1, tags: 1, memberships: 2 });
  assert.equal(links.length, 100);
  assert.deepEqual(links[0], {
    ownerId: 'owner',
    libraryMode: 'MATERIAL',
    assetId: 'target-0',
    tagId: 'target-tag',
    assignedByUser: false,
    assignmentProvenance: 'EAGLE_IMPORTED',
  });
});

test('public/private name conflict renames source without changing existing target attributes', async () => {
  const publicTag = {
    id: 'public',
    normalizedName: 'same',
    marksAssetsPrivate: false,
    color: '#123456',
  };
  const created: Array<Record<string, unknown>> = [];
  const source = {
    libraryMode: 'PHOTO',
    manualTagLinks: [
      {
        tag: {
          id: 'private-tag',
          name: 'Same',
          normalizedName: 'same',
          marksAssetsPrivate: true,
          color: '#abcdef',
          groupMemberships: [],
        },
      },
    ],
  };
  const tx = {
    eagleManualTag: {
      findMany: async ({ where }: { where: { normalizedName: { in: string[] } } }) =>
        [publicTag, ...created].filter((tag) =>
          where.normalizedName.in.includes(String(tag.normalizedName)),
        ),
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.push(...data.map((tag) => ({ ...tag, id: 'private-target' })));
      },
    },
  };
  const mapped = await resolveTransferTagMappings(
    tx as never,
    { ownerId: 'owner', targetMode: 'MATERIAL' },
    [source] as never,
  );
  assert.equal(mapped.tags.get('private-tag')?.id, 'private-target');
  assert.equal(publicTag.color, '#123456');
  assert.equal(publicTag.marksAssetsPrivate, false);
  assert.equal(created[0]?.name, 'Same · photo private-');
  await assert.rejects(
    resolveTransferTagMappings(
      {} as never,
      { ownerId: 'owner', targetMode: 'MATERIAL' },
      [],
      mapped,
    ),
    /scope mismatch/,
  );
});

test('existing target tags keep target group and presentation without creating source groups', async () => {
  const tx = {
    eagleManualTag: {
      findMany: async () => [
        {
          id: 'existing',
          normalizedName: 'same',
          marksAssetsPrivate: false,
          groupId: 'target-group',
        },
      ],
    },
  };
  const mappings = await resolveTransferTagMappings(
    tx as never,
    { ownerId: 'owner', targetMode: 'PHOTO' },
    [
      {
        libraryMode: 'MATERIAL',
        manualTagLinks: [
          {
            tag: { id: 'source', name: 'Same', normalizedName: 'same', marksAssetsPrivate: false },
          },
        ],
      },
    ] as never,
  );
  assert.equal(mappings.tags.get('source')?.groupId, 'target-group');
});

test('large transfer tag sets obey statement budgets without dropping mappings', async () => {
  const saved: Array<Record<string, unknown>> = [];
  let peak = 0;
  const tx = {
    eagleManualTag: {
      findMany: async ({ where }: { where: { normalizedName: { in: string[] } } }) =>
        saved.filter((tag) => where.normalizedName.in.includes(String(tag.normalizedName))),
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        peak = Math.max(peak, data.length);
        assert.ok(data.length <= 512, 'one statement must fit its configured work quantum');
        saved.push(...data.map((tag) => ({ ...tag, id: `target-${String(tag.normalizedName)}` })));
      },
    },
  };
  const mappings = await resolveTransferTagMappings(
    tx as never,
    { ownerId: 'owner', targetMode: 'MATERIAL' },
    [
      {
        libraryMode: 'PHOTO',
        manualTagLinks: Array.from({ length: 3000 }, (_, index) => ({
          tag: {
            id: `tag-${index}`,
            name: `Tag ${index}`,
            normalizedName: `tag ${index}`,
            marksAssetsPrivate: false,
            groupMemberships: [],
          },
        })),
      },
    ] as never,
  );
  assert.equal(mappings.tags.size, 3000);
  assert.ok(peak <= 512);
});
