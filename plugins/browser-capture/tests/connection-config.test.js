import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildServerCandidates, rewritePresignedUploadUrl } from '../src/connection-config.js';

test('automatic mode prefers loopback and falls back to a configured HTTPS public endpoint', () => {
  assert.deepEqual(
    buildServerCandidates({
      connectionMode: 'auto',
      localServerUrl: 'http://localhost:8180/',
      publicServerUrl: 'https://eagle.example.com/',
    }),
    ['http://localhost:8180', 'https://eagle.example.com'],
  );
});

test('public mode requires a public HTTPS endpoint and never accepts remote HTTP', () => {
  assert.deepEqual(
    buildServerCandidates({
      connectionMode: 'public',
      localServerUrl: 'http://localhost:8180',
      publicServerUrl: 'https://eagle.example.com',
    }),
    ['https://eagle.example.com'],
  );
  assert.throws(() =>
    buildServerCandidates({
      connectionMode: 'public',
      localServerUrl: 'http://localhost:8180',
      publicServerUrl: 'http://eagle.example.com',
    }),
  );
});

test('rewrites a loopback-signed upload URL onto the active public gateway only', () => {
  assert.equal(
    rewritePresignedUploadUrl(
      'http://localhost:8180/sekereagle-assets/user/image.jpg?X-Amz-Signature=signed',
      'https://eagle.example.com',
    ),
    'https://eagle.example.com/sekereagle-assets/user/image.jpg?X-Amz-Signature=signed',
  );
  assert.throws(() =>
    rewritePresignedUploadUrl(
      'https://objects.attacker.example/upload?X-Amz-Signature=signed',
      'https://eagle.example.com',
    ),
  );
});

test('gateway preserves the loopback signing host behind a public reverse proxy', async () => {
  const nginx = await readFile(
    new URL('../../../deploy/gateway/nginx.conf', import.meta.url),
    'utf8',
  );

  assert.match(
    nginx,
    /location \^~ \/sekereagle-assets\/[\s\S]*proxy_set_header Host localhost:8180;/,
  );
});
