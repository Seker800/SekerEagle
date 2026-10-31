import assert from 'node:assert/strict';
import test from 'node:test';
import { publishPyramid } from './pyramid-publication';

function fixture(
  current = true,
  lease = 1,
  old = 'users/owner/assets/asset/pyramids/1/pyramid-v1',
) {
  const calls: Array<{ name: string; input: unknown }> = [];
  const record = (name: string, result?: unknown) => async (input: unknown) => {
    calls.push({ name, input });
    return result;
  };
  const tx = {
    $queryRaw: record('lock'),
    eagleAsset: { findFirst: record('scope', current ? { id: 'asset' } : null) },
    eagleAssetProcessingJob: { updateMany: record('lease', { count: lease }) },
    eagleImagePyramid: {
      findUnique: record('previous', old ? { storagePrefix: old } : null),
      upsert: record('pyramid'),
    },
    eagleObjectDeletion: { create: record('retirement') },
  };
  const job = {
    id: 'job',
    ownerId: 'owner',
    libraryMode: 'PHOTO' as const,
    assetId: 'asset',
    assetRevision: 1,
    leaseVersion: 2,
    processorVersion: 'pyramid-v1',
  };
  const input = {
    job,
    storagePrefix: 'users/owner/assets/asset/pyramids/1/attempts/new',
    descriptor: {
      width: 1,
      height: 1,
      tileSize: 512,
      overlap: 1,
      maxLevel: 0,
      format: 'webp' as const,
    },
    tileCount: 1,
    byteSize: 12n,
    outputAttempt: {
      publish: async (tx: unknown) => {
        await record('adoption')(tx);
      },
    },
  };
  return {
    calls,
    input,
    run: () =>
      publishPyramid(
        { $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
        input,
        { lockPrivacy: record('privacy') } as never,
      ),
  };
}

test('a current pyramid atomically adopts new bytes and retires only the previous directory', async () => {
  const f = fixture();
  assert.equal(await f.run(), true);
  assert.equal(f.calls.filter((call) => call.name === 'adoption').length, 1);
  const scope = f.calls.find((call) => call.name === 'scope')!.input as { where: unknown };
  assert.deepEqual(scope.where, {
    id: 'asset',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    mediaRevision: 1,
    deletedAt: null,
  });
  const retirement = f.calls.find((call) => call.name === 'retirement')!.input as {
    data: { prefixes: string[] };
  };
  assert.deepEqual(retirement.data.prefixes, ['users/owner/assets/asset/pyramids/1/pyramid-v1/']);
});

test('a deleted source or stale lease cannot republish a pyramid after ownership handoff', async () => {
  for (const [current, lease] of [
    [false, 1],
    [true, 0],
  ] as const) {
    const f = fixture(current, lease);
    assert.equal(await f.run(), false);
    assert.equal(
      f.calls.some((call) => ['pyramid', 'retirement', 'adoption'].includes(call.name)),
      false,
    );
  }
});

test('a legacy parent prefix cannot retire the newly published child namespace', async () => {
  const f = fixture(true, 1, 'users/owner/assets/asset/pyramids/1');
  await assert.rejects(f.run(), /PYRAMID_OUTPUT_OVERLAP/);
  assert.equal(
    f.calls.some((call) => ['pyramid', 'retirement', 'adoption'].includes(call.name)),
    false,
  );
});
