import assert from 'node:assert/strict';
import test from 'node:test';
import { publishImage } from './image-publication';

function fixture(lease = 1, current = true) {
  const asset = {
    id: 'asset',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    mediaRevision: 0,
    sha256: 'abc',
    libraryAddedAt: new Date(),
    chronologicalAt: new Date(),
  };
  const job = {
    id: 'job',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    assetId: 'asset',
    assetRevision: 0,
    leaseVersion: 2,
  };
  const rendition = {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    assetId: 'asset',
    kind: 'PREVIEW',
    revision: 0,
    variant: 'default',
    storageKey: 'users/owner/assets/asset/renditions/0/preview-default.jpg',
    mimeType: 'image/jpeg',
    byteSize: 500n,
    width: 1920,
    height: 1280,
    status: 'READY',
  };
  const calls: Array<{ operation: string; input: unknown }> = [];
  const record = (operation: string, result?: unknown) => async (input: unknown) => {
    calls.push({ operation, input });
    return result;
  };
  const tx = {
    $queryRaw: record('asset-lock'),
    $executeRaw: record('group-lock'),
    eagleAsset: {
      findFirst: record('scope', current ? asset : null),
      updateMany: record('asset', { count: 1 }),
    },
    eagleAssetProcessingJob: {
      updateMany: record('lease', { count: lease }),
      createMany: record('faces'),
    },
    eagleAssetRendition: { upsert: record('rendition') },
  };
  const client = {
    $transaction: async (
      work: (t: typeof tx) => Promise<unknown>,
      options: { timeout: number },
    ) => {
      assert.equal(options.timeout, 30000);
      return work(tx);
    },
  };
  const dependencies = {
    lockPrivacy: record('privacy-lock'),
    syncPrivacy: record('privacy'),
    persistAnalysis: record('metadata'),
    group: record('group'),
  };
  const input = {
    asset,
    job,
    renditions: [rendition],
    sha256: 'abc',
    dimensions: { width: 6000, height: 4000 },
    livePhoto: null,
    photoAnalysis: null,
    scheduleFaces: false,
  };
  return {
    calls,
    input,
    run: () => publishImage(client as never, input as never, dependencies as never),
  };
}

test('common image publication preserves original dimensions and publishes JPEG with fenced owner/mode/revision', async () => {
  const f = fixture();
  assert.equal(await f.run(), true);
  const scope = f.calls.find((x) => x.operation === 'scope')!.input as { where: unknown };
  assert.deepEqual(scope.where, {
    id: 'asset',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    mediaRevision: 0,
    deletedAt: null,
    sha256: 'abc',
  });
  const lease = f.calls.find((x) => x.operation === 'lease')!.input as { where: unknown };
  assert.deepEqual(lease.where, {
    id: 'job',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    assetId: 'asset',
    assetRevision: 0,
    status: 'PROCESSING',
    leaseVersion: 2,
  });
  const update = f.calls.find((x) => x.operation === 'asset')!.input as {
    data: { width: number; sha256: string };
  };
  assert.equal(update.data.width, 6000);
  assert.equal(update.data.sha256, 'abc');
  assert.equal(f.calls.filter((x) => x.operation === 'rendition').length, 1);
  assert.ok(
    f.calls.findIndex((x) => x.operation === 'asset-lock') <
      f.calls.findIndex((x) => x.operation === 'lease'),
  );
});

test('stale lease and deleted/replaced/foreign asset cannot publish', async () => {
  for (const [lease, current] of [
    [0, true],
    [1, false],
  ] as const) {
    const f = fixture(lease, current);
    assert.equal(await f.run(), false);
    assert.equal(
      f.calls.some((x) => x.operation === 'rendition' || x.operation === 'asset'),
      false,
    );
  }
});

test('rejects foreign or stale renditions before writes', async () => {
  for (const change of [
    { ownerId: 'foreign' },
    { libraryMode: 'MATERIAL' },
    { assetId: 'other' },
    { revision: 1 },
    { storageKey: 'users/foreign/x' },
  ]) {
    const f = fixture();
    Object.assign(f.input.renditions[0]!, change);
    await assert.rejects(f.run(), /IMAGE_PUBLICATION_SCOPE/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.input.job.ownerId = 'foreign';
  await assert.rejects(f.run(), /IMAGE_PUBLICATION_SCOPE/);
});

test('normal photos still persist exposure facts, group and schedule enabled face analysis', async () => {
  const f = fixture();
  Object.assign(f.input, {
    photoAnalysis: { perceptualHash: 'hash', sharpnessScore: 4 },
    livePhoto: { identifier: 'live' },
    scheduleFaces: true,
  });
  assert.equal(await f.run(), true);
  for (const name of ['metadata', 'group', 'faces', 'privacy'])
    assert.ok(f.calls.some((x) => x.operation === name));
});

test('materials use the same publisher without photography locks or analysis', async () => {
  const f = fixture();
  f.input.asset.libraryMode = 'MATERIAL';
  f.input.job.libraryMode = 'MATERIAL';
  f.input.renditions[0]!.libraryMode = 'MATERIAL';
  assert.equal(await f.run(), true);
  assert.equal(
    f.calls.some((x) => x.operation === 'group-lock' || x.operation === 'faces'),
    false,
  );
});

test('lightweight publication schedules one scoped details task only after a current lease is fenced', async () => {
  const f = fixture();
  Object.assign(f.input, { deferDetails: true });
  await f.run();
  const followup = f.calls.find((x) => x.operation === 'faces')!.input as {
    data: Array<Record<string, unknown>>;
    skipDuplicates: boolean;
  };
  assert.equal(followup.skipDuplicates, true);
  assert.deepEqual(followup.data[0], {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    assetId: 'asset',
    assetRevision: 0,
    kind: 'GENERATE_RENDITIONS',
    processorVersion: 'photo-source-details-v1',
    lane: 'BACKGROUND',
    dependsOnJobId: 'job',
  });
  const lost = fixture(0);
  Object.assign(lost.input, { deferDetails: true });
  assert.equal(await lost.run(), false);
  assert.equal(
    lost.calls.some((x) => x.operation === 'faces'),
    false,
  );
});

test('details publication preserves an already browsable asset and its live-photo identity', async () => {
  const f = fixture();
  Object.assign(f.input, { preserveBrowseState: true });
  await f.run();
  const update = (
    f.calls.find((x) => x.operation === 'asset')!.input as { data: Record<string, unknown> }
  ).data;
  assert.equal('lifecycleStatus' in update, false);
  assert.equal('livePhotoIdentifier' in update, false);
  assert.equal('mediaErrorCode' in update, false);
});

test('only a current image publication may consume an immutable output intent', async () => {
  for (const current of [true, false]) {
    const f = fixture(1, current);
    let published = false;
    Object.assign(f.input, {
      outputAttempt: {
        publish: async () => {
          published = true;
        },
      },
    });
    await f.run();
    assert.equal(published, current);
  }
});
