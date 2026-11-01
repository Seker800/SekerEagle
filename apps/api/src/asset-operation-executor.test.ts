import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssetOperationBackground } from './asset-operation-executor';
import { PhotoRevisionObserver } from './photos/photo-revision.observer';

test('standalone recovery assembly retains the PHOTO revision extension and MATERIAL isolation', () => {
  const host = createAssetOperationBackground({} as never, {} as never);
  // This is the provider topology contract: manually assembled operations must match HTTP extensions.
  const recoveries = Reflect.get(host, 'recoveries') as object[];
  const observers = recoveries.map((recovery) => Reflect.get(Reflect.get(recovery, 'uploads') as object, 'revisionObserver') as unknown);
  assert.equal(observers[0], undefined);
  assert.ok(observers[1] instanceof PhotoRevisionObserver);
});
