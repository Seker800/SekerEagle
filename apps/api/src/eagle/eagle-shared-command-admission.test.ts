import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleController } from './eagle.controller';

test('manual tag batches persist intent without invoking the locked domain write', async () => {
  const calls: unknown[] = [];
  const principal = { sub: 'owner', canViewPrivate: false };
  const input = { assetIds: ['asset'], addTagIds: ['tag'], removeTagIds: [], clearAll: false };
  const summary = { id: 'operation', status: 'QUEUED' };
  const controller = new EagleController({} as never, {
    batchChangeManualTags: () => { throw new Error('synchronous domain write must not run'); },
  } as never, {} as never, {} as never, {
    enqueueCommand: async (...args: unknown[]) => { calls.push(args); return summary; },
  } as never);
  assert.equal(await controller.batchChangeManualTags(principal as never, input), summary);
  assert.deepEqual(calls, [[principal, { type: 'ASSET_TAGS', assetIds: input.assetIds, payload: {
    addTagIds: ['tag'], removeTagIds: [], clearAll: false,
  } }]]);
});
