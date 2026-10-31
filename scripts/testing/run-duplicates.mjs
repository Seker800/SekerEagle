import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
const name = `sekereagle-duplicates-test-${randomUUID()}`;
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.status !== 0)
    throw new Error(`${cmd} failed: ${result.stderr ?? ''}${result.stdout ?? ''}`);
  return result.stdout?.trim() ?? '';
}
let started = false;
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
  for (let i = 0; i < 100; i++) {
    const ready = spawnSync('docker', [
      'exec',
      name,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'sekereagle_test',
      '-d',
      'sekereagle_test',
    ]);
    if (ready.status === 0) break;
    if (i === 99) throw new Error('Isolated database not ready');
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
  run(
    process.execPath,
    [
      '--experimental-test-coverage',
      '--test-coverage-include=apps/api/dist/eagle/eagle-duplicates.service.js',
      '--test-coverage-include=apps/api/dist/eagle/eagle-duplicate-*.js',
      '--test-coverage-lines=80',
      '--test-coverage-branches=80',
      '--test-coverage-functions=80',
      '--test',
      'scripts/testing/duplicates.test.mjs',
    ],
    { env, stdio: 'inherit' },
  );
} finally {
  if (started) run('docker', ['stop', name]);
}
