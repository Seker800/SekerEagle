import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
const name = `sekereagle-compute-test-${randomUUID()}`;
let started = false;
function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (r.status !== 0) throw new Error(`${command} failed: ${r.stderr ?? ''}`);
  return r.stdout?.trim() ?? '';
}
try {
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql/data:rw',
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env',
    'POSTGRES_USER=sekereagle_test',
    '--env',
    'POSTGRES_DB=sekereagle_test',
    'pgvector/pgvector:0.8.6-pg16',
  ]);
  started = true;
  const port = run('docker', ['port', name, '5432']).split(':').at(-1);
  if (!/^\d+$/.test(port)) throw new Error('INVALID_TEST_PORT');
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://sekereagle_test@127.0.0.1:${port}/sekereagle_test`,
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'sekereagle-test',
  };
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: env.S3_ENDPOINT,
    s3Bucket: env.S3_BUCKET,
  });
  run(process.execPath, ['scripts/assert-safe-target.mjs'], { env, stdio: 'inherit' });
  for (let i = 0; ; i++) {
    const r = spawnSync(
      'docker',
      ['exec', name, 'pg_isready', '-U', 'sekereagle_test', '-d', 'sekereagle_test'],
      { stdio: 'ignore', timeout: 3000 },
    );
    if (r.status === 0) break;
    if (i >= 60) throw new Error('ISOLATED_DB_TIMEOUT');
    await delay(250);
  }
  run(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      'apps/api/prisma/schema.prisma',
    ],
    { env, stdio: 'inherit' },
  );
  run(process.execPath, ['scripts/testing/compute-worker.mjs'], { env, stdio: 'inherit' });
} finally {
  if (started) {
    const stopped = spawnSync('docker', ['stop', name], { encoding: 'utf8', timeout: 30000 });
    if (stopped.status !== 0) {
      process.stderr.write(`Isolated compute database cleanup was not confirmed: ${name}\n`);
      process.exitCode = 1;
    }
  }
}
