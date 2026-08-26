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
  S3_PUBLIC_ENDPOINT: 'http://localhost:8180',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'sekereagle-test-assets',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
};

void test('accepts the local isolated runtime', () => {
  const result = validateEnvironment(safeEnv);
  assert.equal(result.CANONICAL_ORIGIN, 'http://localhost:8180');
  assert.deepEqual(result.BROWSER_TRUSTED_ORIGINS, ['http://localhost:8180']);
  assert.equal(result.EAGLE_MEDIA_THROTTLE_V2_ENABLED, true);
  assert.equal(result.EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND, 256);
  assert.equal(result.EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_MINUTE, 6_000);
  assert.equal(result.EAGLE_MEDIA_IP_RATE_LIMIT_PER_SECOND, 1_024);
  assert.equal(result.EAGLE_MEDIA_IP_RATE_LIMIT_PER_MINUTE, 24_000);
});

void test('validates bounded media throttle configuration and its rollback flag', () => {
  const configured = validateEnvironment({
    ...safeEnv,
    EAGLE_MEDIA_THROTTLE_V2_ENABLED: 'false',
    EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND: '128',
    EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_MINUTE: '5000',
    EAGLE_MEDIA_IP_RATE_LIMIT_PER_SECOND: '512',
    EAGLE_MEDIA_IP_RATE_LIMIT_PER_MINUTE: '20000',
  });
  assert.equal(configured.EAGLE_MEDIA_THROTTLE_V2_ENABLED, false);
  assert.equal(configured.EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND, 128);

  for (const [key, value] of [
    ['EAGLE_MEDIA_THROTTLE_V2_ENABLED', 'maybe'],
    ['EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND', '31'],
    ['EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_MINUTE', '999'],
    ['EAGLE_MEDIA_IP_RATE_LIMIT_PER_SECOND', '10001'],
    ['EAGLE_MEDIA_IP_RATE_LIMIT_PER_MINUTE', '1000001'],
  ] as const) {
    assert.throws(() => validateEnvironment({ ...safeEnv, [key]: value }), new RegExp(key));
  }
});

void test('accepts exact trusted LAN origins while preserving the canonical origin', () => {
  const result = validateEnvironment({
    ...safeEnv,
    BROWSER_TRUSTED_ORIGINS: 'http://192.168.31.139:8180, https://eagle.example.com',
  });
  assert.deepEqual(result.BROWSER_TRUSTED_ORIGINS, [
    'http://localhost:8180',
    'http://192.168.31.139:8180',
    'https://eagle.example.com',
  ]);
});

void test('rejects unsafe trusted browser origins', () => {
  for (const trustedOrigin of [
    'http://203.0.113.10:8180',
    'http://192.168.31.89:8180',
    'http://*.example.com',
    'https://*.example.com',
    'ftp://192.168.31.139:8180',
    'http://192.168.31.139:8180/path',
    'http://user:password@192.168.31.139:8180',
  ]) {
    assert.throws(() =>
      validateEnvironment({ ...safeEnv, BROWSER_TRUSTED_ORIGINS: trustedOrigin }),
    );
  }
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
