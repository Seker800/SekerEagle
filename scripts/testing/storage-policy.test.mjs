import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
function docker(args, success = true) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
  if (success && result.status !== 0)
    throw new Error(`Isolated storage command failed: ${result.stderr}`);
  return result;
}
test(
  'restricted application user can read/write its private bucket but cannot administer or access another bucket',
  { skip: process.env.SEKEREAGLE_TEST_STORAGE_POLICY !== '1' },
  async () => {
    const name = `sekereagle-storage-test-${randomUUID()}`;
    const network = `${name}-network`;
    const credentials = [
      'MINIO_ROOT_USER=test-root',
      'MINIO_ROOT_PASSWORD=test-root-password-12345',
      'S3_ACCESS_KEY_ID=test-app',
      'S3_SECRET_ACCESS_KEY=test-app-password-12345',
    ];
    let started = false;
    const mc = (script) =>
      docker([
        'run',
        '--rm',
        '--network',
        network,
        ...credentials.flatMap((value) => ['--env', value]),
        '--entrypoint',
        '/bin/sh',
        'minio/mc:RELEASE.2025-04-16T18-13-26Z',
        '-ec',
        script,
      ]);
    try {
      docker(['network', 'create', network]);
      docker([
        'run',
        '--detach',
        '--rm',
        '--name',
        name,
        '--network',
        network,
        '--network-alias',
        'minio',
        '--tmpfs',
        '/data',
        ...credentials.slice(0, 2).flatMap((value) => ['--env', value]),
        'minio/minio:RELEASE.2025-04-22T22-12-26Z',
        'server',
        '/data',
      ]);
      started = true;
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (
          docker(['exec', name, 'curl', '-sf', 'http://localhost:9000/minio/health/live'], false)
            .status === 0
        ) {
          ready = true;
          break;
        }
        await delay(500);
      }
      assert.equal(ready, true, 'isolated MinIO must start');
      docker([
        'run',
        '--rm',
        '--network',
        network,
        ...credentials.flatMap((value) => ['--env', value]),
        '--volume',
        `${root}/deploy/mac/minio-init.sh:/init.sh:ro`,
        '--volume',
        `${root}/deploy/mac/minio-app-policy.json:/policies/app.json:ro`,
        '--entrypoint',
        '/bin/sh',
        'minio/mc:RELEASE.2025-04-16T18-13-26Z',
        '/init.sh',
      ]);
      mc(
        'mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc mb root/unrelated-bucket',
      );
      mc(
        'mc alias set app http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null; printf test | mc pipe app/sekereagle-assets/probe; mc cat app/sekereagle-assets/probe; mc rm app/sekereagle-assets/probe; if mc ls app/unrelated-bucket; then exit 1; fi; if mc admin user list app; then exit 1; fi',
      );
      mc(
        'mc alias set anonymous http://minio:9000 >/dev/null; if mc ls anonymous/sekereagle-assets; then exit 1; fi',
      );
    } finally {
      if (started) docker(['rm', '--force', name], false);
      docker(['network', 'rm', network], false);
    }
  },
);
