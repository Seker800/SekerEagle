import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smartFolderMatchWhere } from '@sekereagle/library-persistence';
import { LibraryMemoryIndex } from './eagle-memory-index';
import { residentSmartFolderPage, type SemanticReadGraph } from './eagle-memory-semantic';

const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const };
const snapshot = { id: 'snapshot', ...scope, folderId: 'folder', isActive: true };
const membership = smartFolderMatchWhere(scope, 'folder');
const row = (id: string, rating = 0) => ({ id, ...scope, rating, isPrivate: false, deletedAt: null, purgeAfter: null, mediaRevision: 0, libraryAddedAt: new Date('2026-11-01T00:00:00Z'), chronologicalAt: new Date('2026-11-01T00:00:00Z') });
const graph: SemanticReadGraph = {
  context: { owner: { id: scope.ownerId, eagleSmartFolders: [{ id: 'folder', ...scope, semanticSnapshots: [snapshot] }] }, embeddings: new Map([['a', [{ id: 'embedding', ...scope, assetId: 'a', assetRevision: 0, smartFolderMatches: [{ ...scope, embeddingId: 'embedding', snapshotId: snapshot.id, snapshot }] }]]]) },
  scores: new Map([['a', new Map([[0, 0.9]])]]),
};
test('resident semantic paging retains existing relevance tiers and ordinary-member cursor boundaries', () => {
  const index = new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
  index.replace('1', [row('a'), row('c', 4), row('b', 4)]);
  const options = { where: { OR: [membership, { rating: 4 }] }, folderIds: ['folder'], limit: 1, ordinaryMembersPossible: true, includePrivate: false, trash: false };
  const first = residentSmartFolderPage(index, graph, options);
  assert.deepEqual(first.map((position) => [position.assetId, position.tier]), [['a', 1], ['c', 0]]);
  const second = residentSmartFolderPage(index, graph, { ...options, after: first[0] });
  assert.deepEqual(second.map((position) => position.assetId), ['c', 'b']);
  const third = residentSmartFolderPage(index, graph, { ...options, after: second[0] });
  assert.deepEqual(third.map((position) => position.assetId), ['b']);
});
test('ready-state, privacy and media-version guards are retained with no model invocation', () => {
  const index = new LibraryMemoryIndex(scope.ownerId, scope.libraryMode);
  index.replace('1', [{ ...row('a'), isPrivate: true }]);
  const options = { where: membership, folderIds: ['folder'], limit: 40, ordinaryMembersPossible: false, includePrivate: false, trash: false };
  assert.deepEqual(residentSmartFolderPage(index, graph, options), []);
  index.update('2', ['a'], [{ ...row('a'), mediaRevision: 1 }]);
  assert.deepEqual(residentSmartFolderPage(index, graph, options), []);
  const unready = { context: { owner: { id: scope.ownerId, eagleSmartFolders: [] }, embeddings: new Map() }, scores: new Map() };
  const guard = { owner: { eagleSmartFolders: { some: { id: 'folder', semanticSnapshots: { some: { isActive: true } } } } } };
  assert.deepEqual(residentSmartFolderPage(index, unready, { ...options, ordinaryMembersPossible: true, where: { AND: [{ NOT: membership }, guard] } }), []);
});

test('semantic scope discovery follows registered relation models and rejects unbounded graph queries', async () => {
  const { semanticFolderIds } = await import('./eagle-memory-semantic');
  assert.deepEqual(semanticFolderIds({ AND: [membership, { NOT: membership }] }), ['folder']);
  assert.deepEqual(semanticFolderIds({ rating: 4 }), []);
  assert.throws(() => semanticFolderIds({ embeddings: { some: { status: 'READY' } } }), /Unsupported/);
});
