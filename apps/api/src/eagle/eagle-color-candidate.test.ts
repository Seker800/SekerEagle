import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorCandidateWhere } from './eagle-color-query';

test('color hydration widens color OR predicates without letting Prisma discard their true branch', () => {
  const scope = { ownerId: 'owner', libraryMode: 'PHOTO' as const, isPrivate: false };
  assert.deepEqual(
    colorCandidateWhere({ ...scope, OR: [{ colorMatch: '#ffffff' }, { rating: 4 }] }),
    scope,
  );
  assert.deepEqual(
    colorCandidateWhere({ ...scope, OR: [{ AND: [{ colorMatch: '#ffffff' }] }, { rating: 4 }] }),
    scope,
  );
  assert.deepEqual(
    colorCandidateWhere({ ...scope, OR: [{ colorMatch: '#ffffff', rating: 2 }, { rating: 4 }] }),
    { ...scope, OR: [{ rating: 2 }, { rating: 4 }] },
  );
  assert.deepEqual(colorCandidateWhere({ ...scope, OR: [] }), { ...scope, OR: [] });
});
