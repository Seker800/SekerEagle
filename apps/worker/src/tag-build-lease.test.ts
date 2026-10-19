import assert from 'node:assert/strict';
import test from 'node:test';
import { claimNextTagBuild, holdTagBuildLease } from './tag-build-lease';

const now = new Date('2026-10-19T00:00:00Z');
const candidate = {
  id: 'build-1',
  ownerId: 'owner-1',
  libraryMode: 'PHOTO',
  status: 'PROCESSING',
  leaseVersion: 3,
  lockedAt: new Date(now.getTime() - 11 * 60_000),
  attempts: 2,
  startedAt: now,
  candidateSnapshotId: 'snapshot-1',
};
function fixture(row: typeof candidate | null, count = 1) {
  const writes: Array<{ where: unknown; data: unknown }> = [];
  const retired: unknown[] = [];
  const tx = {
    eagleTagSemanticBuild: {
      findFirst: async () => row,
      updateMany: async (input: (typeof writes)[number]) => {
        writes.push(input);
        return { count };
      },
      findUnique: async () => ({ ...row, leaseVersion: 4 }),
    },
    eagleTagPrototypeSnapshot: {
      updateMany: async (input: unknown) => {
        retired.push(input);
        return { count: 1 };
      },
    },
  };
  return {
    tx,
    writes,
    retired,
    client: { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx) },
  };
}
test('reclaim fences the observed lease and retires only the old candidate after a successful claim', async () => {
  const f = fixture(candidate);
  const claimed = await claimNextTagBuild(f.client as never, now);
  assert.equal(claimed?.leaseVersion, 4);
  assert.deepEqual((f.writes[0]!.where as Record<string, unknown>).lockedAt, candidate.lockedAt);
  assert.equal(f.retired.length, 1);
});
test('a lease renewed or taken by another worker cannot be claimed or retire its snapshot', async () => {
  const f = fixture(candidate, 0);
  assert.equal(await claimNextTagBuild(f.client as never, now), null);
  assert.equal(f.retired.length, 0);
});
test('empty queue and exhausted attempts converge without starting another build', async () => {
  const empty = fixture(null);
  assert.equal(await claimNextTagBuild(empty.client as never, now), null);
  assert.equal(empty.writes.length, 0);
  const exhausted = fixture({ ...candidate, attempts: 12 });
  assert.equal(await claimNextTagBuild(exhausted.client as never, now), null);
  assert.equal((exhausted.writes[0]!.data as { status: string }).status, 'FAILED');
  assert.equal(exhausted.retired.length, 1);
  const lost = fixture({ ...candidate, attempts: 12 }, 0);
  await claimNextTagBuild(lost.client as never, now);
  assert.equal(lost.retired.length, 0);
});
test('publication requires the current owner, mode and lease before writing visible results', async () => {
  const f = fixture(candidate);
  await holdTagBuildLease(f.tx as never, candidate as never, now);
  assert.deepEqual(f.writes[0]!.where, {
    id: candidate.id,
    ownerId: candidate.ownerId,
    libraryMode: candidate.libraryMode,
    status: 'PROCESSING',
    leaseVersion: 3,
  });
  const lost = fixture(candidate, 0);
  await assert.rejects(
    holdTagBuildLease(lost.tx as never, candidate as never, now),
    /TAG_BUILD_LEASE_LOST/,
  );
});
