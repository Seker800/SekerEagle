import assert from 'node:assert/strict';
import test from 'node:test';
import { publishImage } from './image-publication';

function fixture(lease = 1, current = true) {
  const asset = { id: 'asset', ownerId: 'owner', libraryMode: 'PHOTO', mediaRevision: 0, sha256: 'abc', libraryAddedAt: new Date(), chronologicalAt: new Date() };
  const job = { id: 'job', ownerId: 'owner', libraryMode: 'PHOTO', assetId: 'asset', assetRevision: 0, leaseVersion: 2 };
  const rendition = { ownerId: 'owner', libraryMode: 'PHOTO', assetId: 'asset', kind: 'PREVIEW', revision: 0, variant: 'default', storageKey: 'users/owner/assets/asset/renditions/0/preview-default.jpg', mimeType: 'image/jpeg', byteSize: 500n, width: 1920, height: 1280, status: 'READY' };
  const calls: Array<{ operation: string; input: unknown }> = [];
  const record = (operation: string, result?: unknown) => async (input: unknown) => { calls.push({ operation, input }); return result; };
  const tx = {
    $queryRaw: record('asset-lock'), $executeRaw: record('group-lock'),
    eagleAsset: { findFirst: record('scope', current ? asset : null), updateMany: record('asset', { count: 1 }) },
    eagleAssetProcessingJob: { updateMany: record('lease', { count: lease }), createMany: record('faces') },
    eagleAssetRendition: { upsert: record('rendition') },
  };
  const client = { $transaction: async (work: (t: typeof tx) => Promise<unknown>, options: { timeout: number }) => { assert.equal(options.timeout, 30000); return work(tx); } };
  const dependencies = { lockPrivacy: record('privacy-lock'), syncPrivacy: record('privacy'), persistAnalysis: record('metadata'), group: record('group') };
  const input = { asset, job, renditions: [rendition], sha256: 'abc', dimensions: { width: 6000, height: 4000 }, livePhoto: null, photoAnalysis: null, scheduleFaces: false };
  return { calls, input, run: () => publishImage(client as never, input as never, dependencies as never) };
}

test('common image publication preserves original dimensions and publishes JPEG with fenced owner/mode/revision', async () => {
  const f = fixture(); assert.equal(await f.run(), true);
  const scope = f.calls.find(x => x.operation === 'scope')!.input as { where: unknown };
  assert.deepEqual(scope.where, { id: 'asset', ownerId: 'owner', libraryMode: 'PHOTO', mediaRevision: 0, deletedAt: null, sha256: 'abc' });
  const lease = f.calls.find(x => x.operation === 'lease')!.input as { where: unknown };
  assert.deepEqual(lease.where, { id: 'job', ownerId: 'owner', libraryMode: 'PHOTO', assetId: 'asset', assetRevision: 0, status: 'PROCESSING', leaseVersion: 2 });
  const update = f.calls.find(x => x.operation === 'asset')!.input as { data: { width: number; sha256: string } };
  assert.equal(update.data.width, 6000); assert.equal(update.data.sha256, 'abc');
  assert.equal(f.calls.filter(x => x.operation === 'rendition').length, 1);
  assert.ok(f.calls.findIndex(x => x.operation === 'asset-lock') < f.calls.findIndex(x => x.operation === 'lease'));
});

test('stale lease and deleted/replaced/foreign asset cannot publish', async () => {
  for (const [lease, current] of [[0, true], [1, false]] as const) {
    const f = fixture(lease, current); assert.equal(await f.run(), false);
    assert.equal(f.calls.some(x => x.operation === 'rendition' || x.operation === 'asset'), false);
  }
});

test('rejects foreign or stale renditions before writes', async () => {
  for (const change of [{ ownerId: 'foreign' }, { libraryMode: 'MATERIAL' }, { assetId: 'other' }, { revision: 1 }, { storageKey: 'users/foreign/x' }]) {
    const f = fixture(); Object.assign(f.input.renditions[0]!, change);
    await assert.rejects(f.run(), /IMAGE_PUBLICATION_SCOPE/); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.input.job.ownerId = 'foreign';
  await assert.rejects(f.run(), /IMAGE_PUBLICATION_SCOPE/);
});
