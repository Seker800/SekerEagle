import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const image = process.argv[2];
assert.match(image ?? '', /^sekereagle\/api:[a-zA-Z0-9_.-]+$/, 'Pass an explicit local API image');
const prefix = `sekereagle-api-image-${randomUUID()}`;
const containers = [];
let networkCreated = false;
const password = randomBytes(24).toString('hex');
const accessKey = randomBytes(16).toString('hex');
const secretKey = randomBytes(32).toString('hex');
const tokenKey = randomBytes(32).toString('hex');
const env = {
  DATABASE_URL: `postgresql://sekereagle_test:${password}@postgres:5432/sekereagle_test`,
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:8180',
  S3_BUCKET: 'sekereagle-test',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: accessKey,
  S3_SECRET_ACCESS_KEY: secretKey,
  JWT_ACCESS_SECRET: tokenKey,
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_SECONDS: '2592000',
  CANONICAL_ORIGIN: 'http://localhost:8180',
  PORT: '3000',
  MLX_EMBEDDING_URL: 'http://127.0.0.1:1',
  MLX_EMBEDDING_TOKEN: tokenKey,
  EAGLE_BACKGROUND_PROCESSING_ENABLED: 'false',
};
assertSafeRuntimeTarget({
  databaseUrl: env.DATABASE_URL,
  s3Endpoint: env.S3_ENDPOINT,
  s3Bucket: env.S3_BUCKET,
});
const envArgs = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
function run(args, timeout = 120000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`API image smoke: docker ${args[0]} failed`);
  return result.stdout.trim();
}
async function waitFor(check, name, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error(`API image smoke: ${name} timed out`);
}
try {
  run(['image', 'inspect', image]);
  run(['network', 'create', prefix]);
  networkCreated = true;
  const pg = `${prefix}-postgres`;
  containers.push(pg);
  run([
    'run',
    '--detach',
    '--rm',
    '--name',
    pg,
    '--network',
    prefix,
    '--network-alias',
    'postgres',
    '--tmpfs',
    '/var/lib/postgresql/data:rw',
    '--env',
    'POSTGRES_USER=sekereagle_test',
    '--env',
    'POSTGRES_DB=sekereagle_test',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    'pgvector/pgvector:0.8.6-pg16',
  ]);
  await waitFor(
    () =>
      spawnSync(
        'docker',
        ['exec', pg, 'pg_isready', '-U', 'sekereagle_test', '-d', 'sekereagle_test'],
        { stdio: 'ignore', timeout: 3000 },
      ).status === 0,
    'isolated database',
  );
  const minio = `${prefix}-minio`;
  containers.push(minio);
  run([
    'run',
    '--detach',
    '--rm',
    '--name',
    minio,
    '--network',
    prefix,
    '--network-alias',
    'minio',
    '--tmpfs',
    '/data:rw',
    '--env',
    `MINIO_ROOT_USER=${accessKey}`,
    '--env',
    `MINIO_ROOT_PASSWORD=${secretKey}`,
    'minio/minio:RELEASE.2025-04-22T22-12-26Z',
    'server',
    '/data',
  ]);
  const setup = `${prefix}-setup`;
  containers.push(setup);
  run([
    'run',
    '--rm',
    '--pull',
    'never',
    '--name',
    setup,
    '--network',
    prefix,
    ...envArgs,
    image,
    'sh',
    '-c',
    'node scripts/assert-safe-target.mjs && npm run db:migrate:deploy',
  ]);
  const bucketSetup = `${prefix}-bucket`;
  containers.push(bucketSetup);
  run([
    'run',
    '--rm',
    '--pull',
    'never',
    '--name',
    bucketSetup,
    '--network',
    prefix,
    ...envArgs,
    image,
    'node',
    '-e',
    `const {S3Client,CreateBucketCommand}=require('@aws-sdk/client-s3');const s=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});s.send(new CreateBucketCommand({Bucket:process.env.S3_BUCKET})).finally(()=>s.destroy());`,
  ]);
  const api = `${prefix}-api`;
  containers.push(api);
  run([
    'run',
    '--detach',
    '--pull',
    'never',
    '--name',
    api,
    '--network',
    prefix,
    '--publish',
    '127.0.0.1::3000',
    ...envArgs,
    image,
  ]);
  const port = run(['port', api, '3000']).split(':').at(-1);
  assert.match(port, /^\d+$/);
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    try {
      return (
        (await fetch(`${origin}/api/health/ready`, { signal: AbortSignal.timeout(2000) }))
          .status === 200
      );
    } catch {
      return false;
    }
  }, 'final image readiness');
  for (const path of [
    '/api/photos/photography/people/summary',
    '/api/photos/photography/people/review',
  ])
    assert.equal((await fetch(`${origin}${path}`)).status, 401);
  process.stdout.write(
    JSON.stringify({
      image,
      isolatedFinalImageBoot: true,
      migrations: true,
      readiness: 200,
      unauthenticatedPeople: 401,
    }) + '\n',
  );
} catch (error) {
  const last = containers.at(-1);
  if (last?.endsWith('-api')) {
    const logs = spawnSync('docker', ['logs', '--tail', '80', last], {
      encoding: 'utf8',
      timeout: 5000,
    });
    let diagnostic = `${logs.stdout ?? ''}${logs.stderr ?? ''}`;
    for (const value of [password, accessKey, secretKey, tokenKey])
      diagnostic = diagnostic.replaceAll(value, '[test value]');
    process.stderr.write(diagnostic);
  }
  throw error;
} finally {
  for (const name of containers.reverse())
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', timeout: 30000 });
  if (networkCreated)
    spawnSync('docker', ['network', 'rm', prefix], { stdio: 'ignore', timeout: 30000 });
}
