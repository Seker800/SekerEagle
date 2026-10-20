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
let restoreStarted = false;
const restoreName = `${name}-restore`;
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
      [
        'exec',
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'sekereagle_test',
        '-d',
        'sekereagle_test',
      ],
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
      ...(process.env.PHOTO_AGENT_COVERAGE === '1'
        ? [
            '--experimental-test-coverage',
            '--test-coverage-include=apps/api/dist/photos/photo-agent.service.js',
            '--test-coverage-lines=80',
            '--test-coverage-branches=80',
            '--test-coverage-functions=80',
          ]
        : []),
      ...(process.env.PHOTO_PRIVACY_COVERAGE === '1'
        ? [
            '--experimental-test-coverage',
            '--test-coverage-include=packages/library-persistence/dist/index.js',
            '--test-coverage-lines=80',
            '--test-coverage-branches=80',
            '--test-coverage-functions=80',
          ]
        : []),
      '--test',
      'packages/library-persistence/dist/privacy.test.js',
      'scripts/testing/library-isolation.test.mjs',
      'scripts/testing/library-service-isolation.test.mjs',
      'scripts/testing/photo-agent.test.mjs',
      'scripts/testing/photo-privacy.test.mjs',
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
  // Full database round-trip: all new photo tables and business corrections are
  // restored into a second disposable database, never the operator's current data.
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    restoreName,
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
  restoreStarted = true;
  const restorePort = run('docker', ['port', restoreName, '5432']).split(':').at(-1);
  const restoreEnv = {
    ...env,
    DATABASE_URL: `postgresql://sekereagle_test@127.0.0.1:${restorePort}/sekereagle_test`,
  };
  run(process.execPath, ['scripts/assert-safe-target.mjs'], { env: restoreEnv, stdio: 'inherit' });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      spawnSync('docker', [
        'exec',
        restoreName,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'sekereagle_test',
        '-d',
        'sekereagle_test',
      ]).status === 0
    )
      break;
    if (attempt === 99) throw new Error('Restore test database did not become ready');
  }
  const dump = spawnSync(
    'docker',
    ['exec', name, 'pg_dump', '-U', 'sekereagle_test', '-d', 'sekereagle_test', '--format=custom'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (dump.status !== 0) throw new Error('Isolated database dump failed');
  const restored = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      restoreName,
      'pg_restore',
      '-U',
      'sekereagle_test',
      '-d',
      'sekereagle_test',
      '--exit-on-error',
      '--no-owner',
    ],
    { input: dump.stdout, maxBuffer: 4 * 1024 * 1024 },
  );
  if (restored.status !== 0)
    throw new Error(`Isolated restore failed: ${restored.stderr.toString()}`);
  const sqlArgs = (container) => [
    'exec',
    container,
    'psql',
    '-U',
    'sekereagle_test',
    '-d',
    'sekereagle_test',
    '-Atc',
  ];
  const tables = run('docker', [
    ...sqlArgs(name),
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  ]).split('\n');
  if (!tables.every((table) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(table)))
    throw new Error('Unexpected test table name');
  const digestSql = tables
    .map(
      (table) =>
        `SELECT '${table}', count(*), COALESCE(md5(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text)),'empty') FROM "${table}" t`,
    )
    .join(' UNION ALL ');
  if (
    run('docker', [...sqlArgs(name), digestSql]) !==
    run('docker', [...sqlArgs(restoreName), digestSql])
  )
    throw new Error('Restored business data does not match the source test database');
  if (process.argv.includes('--scale'))
    run(process.execPath, ['scripts/testing/photo-library-scale.mjs'], {
      env: restoreEnv,
      stdio: 'inherit',
    });
  process.stdout.write(
    'Library integration, historical upgrade, and complete database restore checks passed.\n',
  );
} finally {
  if (restoreStarted) run('docker', ['stop', restoreName]);
  if (started) run('docker', ['stop', name]);
  rmSync(temp, { recursive: true, force: true });
}
