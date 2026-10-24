import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeRuntimeTarget, describeRuntimeTarget } from './index';

const safeTarget = {
  databaseUrl: 'postgresql://sekereagle:secret@postgres:5432/sekereagle?schema=public',
  s3Endpoint: 'http://minio:9000',
  s3Bucket: 'sekereagle-assets',
};

void test('accepts the isolated compose target', () => {
  assert.doesNotThrow(() => assertSafeRuntimeTarget(safeTarget));
  assert.equal(describeRuntimeTarget(safeTarget).includes('secret'), false);
});

void test('rejects the NAS address', () => {
  assert.throws(() =>
    assertSafeRuntimeTarget({
      ...safeTarget,
      databaseUrl: 'postgresql://x:y@192.168.31.89:5432/sekereagle',
    }),
  );
});

void test('rejects every SekerChat database name', () => {
  assert.throws(() =>
    assertSafeRuntimeTarget({
      ...safeTarget,
      databaseUrl: 'postgresql://x:y@localhost:5432/sekerchat_dev',
    }),
  );
});

void test('rejects unknown buckets and hosts', () => {
  assert.throws(() => assertSafeRuntimeTarget({ ...safeTarget, s3Bucket: 'sekerchat-dev' }));
  assert.throws(() =>
    assertSafeRuntimeTarget({ ...safeTarget, s3Endpoint: 'http://example.com:9000' }),
  );
});
