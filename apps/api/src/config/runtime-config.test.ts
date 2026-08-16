import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnvironment } from './runtime-config';

const safeEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  CANONICAL_ORIGIN: 'http://localhost:8180',
  DATABASE_URL: 'postgresql://sekereagle:secret@postgres-test:5432/sekereagle_test?schema=public',
  JWT_ACCESS_SECRET: 'a-secure-test-secret-with-more-than-32-characters',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_SECONDS: '2592000',
  S3_ENDPOINT: 'http://minio-test:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'sekereagle-test-assets',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
};

void test('accepts the local isolated runtime', () => {
  const result = validateEnvironment(safeEnv);
  assert.equal(result.CANONICAL_ORIGIN, 'http://localhost:8180');
});

void test('rejects a non-HTTPS remote origin', () => {
  assert.throws(() =>
    validateEnvironment({ ...safeEnv, CANONICAL_ORIGIN: 'http://192.168.31.139:8180' }),
  );
});

void test('rejects a short session secret', () => {
  assert.throws(() => validateEnvironment({ ...safeEnv, JWT_ACCESS_SECRET: 'short' }));
});

void test('rejects a SekerChat database target', () => {
  assert.throws(() =>
    validateEnvironment({
      ...safeEnv,
      DATABASE_URL: 'postgresql://x:y@localhost:5432/sekerchat_dev',
    }),
  );
});
