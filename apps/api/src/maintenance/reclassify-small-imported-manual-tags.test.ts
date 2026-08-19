import assert from 'node:assert/strict';
import test from 'node:test';

import {
  migrateSmartFolderQuery,
  parseReclassificationArgs,
  selectReclassificationCandidates,
} from './reclassify-small-imported-manual-tags';

function tag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tag-1',
    name: '自动标签',
    normalizedName: '自动标签',
    isStarred: false,
    groupId: null,
    semanticConfig: null,
    assetLinks: [
      { assignedByUser: false, asset: { id: 'asset-1', mediaRevision: 1, deletedAt: null } },
    ],
    ...overrides,
  };
}

test('selects only small imported tags and counts active assets', () => {
  const selected = selectReclassificationCandidates([
    tag(),
    tag({ id: 'unused', assetLinks: [] }),
    tag({
      id: 'manual',
      assetLinks: [
        { assignedByUser: true, asset: { id: 'asset-2', mediaRevision: 1, deletedAt: null } },
      ],
    }),
    tag({
      id: 'large',
      assetLinks: Array.from({ length: 6 }, (_, index) => ({
        assignedByUser: false,
        asset: { id: `asset-${index}`, mediaRevision: 1, deletedAt: null },
      })),
    }),
    tag({
      id: 'with-trash',
      assetLinks: [
        { assignedByUser: false, asset: { id: 'active', mediaRevision: 1, deletedAt: null } },
        { assignedByUser: false, asset: { id: 'trash', mediaRevision: 1, deletedAt: new Date() } },
      ],
    }),
  ]);

  assert.deepEqual(
    selected.candidates.map(({ id, activeAssetCount, totalAssetCount }) => ({
      id,
      activeAssetCount,
      totalAssetCount,
    })),
    [
      { id: 'tag-1', activeAssetCount: 1, totalAssetCount: 1 },
      { id: 'with-trash', activeAssetCount: 1, totalAssetCount: 2 },
    ],
  );
  assert.equal(selected.skipped.unused, 1);
  assert.equal(selected.skipped.userAssigned, 1);
  assert.equal(selected.skipped.aboveThreshold, 1);
});

test('parses an explicit owner and keeps dry-run as the default', () => {
  assert.deepEqual(parseReclassificationArgs(['--owner-email=user@example.com']), {
    ownerEmail: 'user@example.com',
    maxAssetCount: 5,
    apply: false,
    confirmedTagCount: null,
  });
  assert.deepEqual(
    parseReclassificationArgs([
      '--owner-email=USER@example.com',
      '--max-assets=3',
      '--apply',
      '--confirm-tag-count=17',
    ]),
    {
      ownerEmail: 'user@example.com',
      maxAssetCount: 3,
      apply: true,
      confirmedTagCount: 17,
    },
  );
  assert.throws(() => parseReclassificationArgs([]), /owner-email/);
  assert.throws(
    () => parseReclassificationArgs(['--owner-email=user@example.com', '--apply']),
    /confirm-tag-count/,
  );
});

test('moves smart-folder dependencies from manual tags to AI tags without changing match mode', () => {
  assert.deepEqual(
    migrateSmartFolderQuery(
      {
        version: 1,
        filters: {
          tagMatch: 'ANY',
          manualTagIds: ['keep-manual', 'move-manual'],
          aiTagIds: ['keep-ai'],
        },
      },
      new Map([['move-manual', 'moved-ai']]),
    ),
    {
      version: 1,
      filters: {
        tagMatch: 'ANY',
        manualTagIds: ['keep-manual'],
        aiTagIds: ['keep-ai', 'moved-ai'],
      },
    },
  );
});
