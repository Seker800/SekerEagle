import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStatelessGraph } from './build-agent.mjs';
test('standalone executors reject database, object storage and application persistence dependencies', () => {
  assertStatelessGraph({
    'apps/worker/src/face-inference.ts': {},
    'packages/media-core/src/index.ts': {},
  });
  for (const input of [
    'packages/library-persistence/dist/index.js',
    'node_modules/@prisma/client/index.js',
    'node_modules/@aws-sdk/client-s3/index.js',
    'apps/api/src/main.ts',
    'node_modules/pg/index.js',
    'node_modules/.prisma/client/index.js',
    'node_modules/@smithy/client/index.js',
  ])
    assert.throws(() => assertStatelessGraph({ [input]: {} }));
});
