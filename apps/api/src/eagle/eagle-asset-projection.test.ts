import assert from 'node:assert/strict';
import test from 'node:test';

test('asset projections share one safe read model without importing the application service', () => {
  const { serializeAssetList, serializeAsset, assetListInclude } = require('./eagle-asset-projection') as {
    serializeAssetList: (asset: never) => Record<string, unknown>;
    serializeAsset: (asset: never) => Record<string, unknown>;
    assetListInclude: Record<string, unknown>;
  };
  const row = {
    id: 'asset', libraryMode: 'PHOTO', originalName: 'photo.jpg', displayName: 'photo',
    mediaRevision: 2, rowVersion: 3, byteSize: 42n, isPrivate: true,
    ownerId: 'secret-owner', originalObjectKey: 'private-storage-key',
    photoMetadata: { cameraMake: 'camera' },
    photoLocation: { assetRevision: 1, name: 'stale-place' },
    manualTagLinks: [{ tag: { id: 'tag', name: 'private', marksAssetsPrivate: true } }],
    renditions: [{ id: 'thumb', kind: 'THUMBNAIL', byteSize: 12n }],
    annotation: null, aiTagLinks: [], colorAnalyses: [],
    photoFaces: [
      { assetRevision: 1, person: { id: 'old', name: 'old' } },
      { assetRevision: 2, person: { id: 'person', name: 'current' } },
      { assetRevision: 2, person: { id: 'person', name: 'current' } },
    ],
  };
  const list = serializeAssetList(row as never);
  assert.equal(list.ownerId, undefined);
  assert.equal(list.originalObjectKey, undefined);
  assert.equal(list.byteSize, 42);
  assert.equal(list.photoLocation, null);
  assert.equal(list.originalUrl, '/api/photos/assets/asset/original');
  assert.deepEqual(list.renditions, [{ id: 'thumb', kind: 'THUMBNAIL', byteSize: 12, url: '/api/photos/assets/asset/renditions/thumb' }]);
  const details = serializeAsset(row as never);
  assert.deepEqual(details.privacyReasons, [{ kind: 'TAG', id: 'tag', name: 'private' }, { kind: 'PERSON', id: 'person', name: 'current' }]);
  assert.equal(details.photoFaces, undefined);
  assert.equal(details.ownerId, undefined);
  assert.ok(assetListInclude.photoMetadata);
  assert.equal(serializeAssetList({ ...row, libraryMode: 'MATERIAL', photoLocation: { assetRevision: 2 } } as never).originalUrl, '/api/eagle/assets/asset/original');
  assert.deepEqual(serializeAsset({ ...row, isPrivate: false } as never).privacyReasons, []);
});
