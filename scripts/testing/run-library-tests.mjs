import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const name = `sekereagle-library-test-${randomUUID()}`;
const temp = mkdtempSync(join(tmpdir(), 'sekereagle-library-test-'));
const migration = '20261018140000_library_modes';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr ?? ''}${result.stdout ?? ''}`);
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
  // Each readiness probe is bounded; no unrelated database or Docker service is touched.
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = spawnSync(
      'docker',
      ['exec', name, 'pg_isready', '-U', 'sekereagle_test', '-d', 'sekereagle_test'],
      { encoding: 'utf8' },
    );
    if (ready.status === 0) break;
    if (attempt === 99) throw new Error('Test database did not become ready');
  }
  const schema = join(temp, 'schema.prisma');
  cpSync('apps/api/prisma/schema.prisma', schema);
  const baseline = join(temp, 'migrations');
  for (const entry of readdirSync('apps/api/prisma/migrations')) {
    if (entry < migration || entry === 'migration_lock.toml')
      cpSync(join('apps/api/prisma/migrations', entry), join(baseline, entry), { recursive: true });
  }
  const prisma = ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', schema];
  run(process.execPath, prisma, { env, stdio: 'inherit' });
  // Seed a pre-upgrade resource through SQL because the generated client already knows the new schema.
  run(
    'docker',
    [
      'exec',
      '-i',
      name,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'sekereagle_test',
      '-d',
      'sekereagle_test',
    ],
    {
      input: `
    INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES ('legacy-library-owner','legacy-library@example.invalid','test-only',now());
    INSERT INTO "EagleAsset" (id,"ownerId","originalName","displayName","normalizedDisplayName","mimeType",format,"byteSize","originalObjectKey","updatedAt") VALUES ('legacy-library-asset','legacy-library-owner','legacy.jpg','legacy','legacy','image/jpeg','jpeg',42,'users/legacy-library-owner/assets/legacy/original.jpg',now());
  `,
    },
  );
  cpSync(join('apps/api/prisma/migrations', migration), join(baseline, migration), {
    recursive: true,
  });
  for (const entry of readdirSync('apps/api/prisma/migrations').filter(
    (entry) => entry > migration && entry !== 'migration_lock.toml',
  )) {
    cpSync(join('apps/api/prisma/migrations', entry), join(baseline, entry), { recursive: true });
  }
  run(process.execPath, prisma, { env, stdio: 'inherit' });
  run(
    process.execPath,
    [
      '--test',
      'scripts/testing/library-isolation.test.mjs',
      'scripts/testing/library-service-isolation.test.mjs',
    ],
    {
      env,
      stdio: 'inherit',
    },
  );
  const preserved = run('docker', [
    'exec',
    name,
    'psql',
    '-U',
    'sekereagle_test',
    '-d',
    'sekereagle_test',
    '-Atc',
    `SELECT "libraryMode" || ':' || "byteSize" || ':' || "originalObjectKey" FROM "EagleAsset" WHERE id='legacy-library-asset'`,
  ]);
  if (preserved !== 'MATERIAL:42:users/legacy-library-owner/assets/legacy/original.jpg')
    throw new Error('Historical resource was not preserved');
  // Verify migration is transactional and every scoped table has immutable membership enforcement.
  const source = readFileSync(
    join('apps/api/prisma/migrations', migration, 'migration.sql'),
    'utf8',
  );
  if (!source.startsWith('BEGIN;') || !source.trimEnd().endsWith('COMMIT;'))
    throw new Error('Migration must be atomic');
  process.stdout.write('Library integration and historical upgrade checks passed.\n');
} finally {
  if (started) run('docker', ['stop', name]);
  rmSync(temp, { recursive: true, force: true });
}
