import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComputeRuntime, remoteMediaKinds } from './compute-runtime';
test('coordinator state is bounded and strips credentials', () => {
  const input = {
    protocol: 'sekereagle-compute-v1',
    capacity: { backgroundLimit: 4 },
    fleet: {
      revision: 2,
      nodes: [
        {
          id: 'mac',
          name: 'Mac',
          accelerator: 'metal',
          enabled: true,
          health: 'READY',
          concurrency: 2,
          inFlight: 1,
          operations: ['embedding', 'image'],
          url: 'secret',
          token: 'secret',
        },
      ],
    },
  };
  const state = parseComputeRuntime(input);
  assert.equal(state?.backgroundLimit, 4);
  assert.ok(!JSON.stringify(state).includes('secret'));
  assert.deepEqual(remoteMediaKinds(state), [
    'GENERATE_RENDITIONS',
    'GENERATE_THUMBNAIL',
    'GENERATE_PREVIEW',
  ]);
  assert.equal(parseComputeRuntime({ ...input, capacity: { backgroundLimit: 99 } }), null);
  assert.equal(parseComputeRuntime({ ...input, protocol: 'other' }), null);
  assert.deepEqual(remoteMediaKinds(null), []);
});
