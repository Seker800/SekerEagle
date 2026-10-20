#!/usr/bin/env node
// Render NAS deployment from the same service definitions as the Mac runtime.
// This command only prepares files. It cannot stop or deploy the Mac instance.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const origin = 'http://192.168.31.146:8181';
const project = 'sekereagle-nas-staging';

export function createNasStagingCompose(base, { revision }) {
  if (!/^[a-f0-9]{12,40}$/u.test(revision)) throw new Error('Invalid source revision');
  const compose = globalThis.structuredClone(base);
  compose.name = project;
  delete compose['x-api-environment'];
  const services = compose.services;
  for (const [name, service] of Object.entries(services)) {
    service.platform = 'linux/amd64';
    delete service.ports;
    if (service.build) {
      service.image = `sekereagle/${name === 'migrate' ? 'api' : name}:nas-${revision}`;
      delete service.build;
    }
  }
  services.postgres.environment.POSTGRES_DB = 'sekereagle_test';
  services.postgres.healthcheck.test[1] = 'pg_isready -U $$POSTGRES_USER -d sekereagle_test';
  services.postgres.mem_limit = '1536m';
  services.postgres.shm_size = '256m';
  services.minio.mem_limit = '1g';
  for (const name of ['api', 'worker', 'migrate']) {
    const env = services[name].environment;
    env.DATABASE_URL = env.DATABASE_URL.replace('/sekereagle?', '/sekereagle_test?');
    env.CANONICAL_ORIGIN = origin;
    env.S3_PUBLIC_ENDPOINT = origin;
    env.BROWSER_TRUSTED_ORIGINS = '';
    env.ALLOW_INSECURE_PUBLIC_HTTP_ORIGINS = 'false';
    // No restored queue may silently call inference on the production Mac.
    env.MLX_EMBEDDING_URL = 'http://127.0.0.1:11435';
    env.OLLAMA_URL = 'http://127.0.0.1:11434';
    delete env.SEKEREAGLE_BACKUP_STATUS_FILE;
    services[name].mem_limit = name === 'worker' ? '2g' : '1g';
  }
  delete services.api.volumes;
  services.worker.environment.EAGLE_INTERACTIVE_CONCURRENCY = '1';
  // Enable processing only after reviewing restored queues and inference routing.
  services.worker.profiles = ['processing'];
  services['minio-init'].volumes = [
    './minio-init.sh:/init.sh:ro',
    './minio-app-policy.json:/policies/app.json:ro',
  ];
  services.gateway.ports = ['192.168.31.146:8181:8080'];
  services.gateway.volumes = ['./nginx.conf:/etc/nginx/conf.d/default.conf:ro'];
  for (const volume of Object.values(compose.volumes)) delete volume.name;
  return compose;
}

export function createNasGateway(source) {
  const marker = 'proxy_set_header Host localhost:8180;';
  if (source.split(marker).length !== 2) throw new Error('Upload gateway host contract changed');
  return source
    .replace(marker, 'proxy_set_header Host 192.168.31.146:8181;')
    .replace('loopback identity', 'canonical identity');
}

export async function prepareNasPackage(directory, revision) {
  const root = new URL('..', import.meta.url);
  const compose = createNasStagingCompose(
    yaml.load(await readFile(new URL('deploy/mac/docker-compose.yml', root), 'utf8')),
    { revision },
  );
  // Exclusive creation prevents overwriting credentials or an existing install.
  await mkdir(directory, { mode: 0o700 });
  const write = (name, contents) =>
    writeFile(resolve(directory, name), contents, {
      mode: name === '.env' ? 0o600 : 0o644,
      flag: 'wx',
    });
  await write('compose.yml', yaml.dump(compose, { noRefs: true, lineWidth: 110 }));
  await write(
    'nginx.conf',
    createNasGateway(await readFile(new URL('deploy/gateway/nginx.conf', root), 'utf8')),
  );
  for (const name of ['minio-init.sh', 'minio-app-policy.json']) {
    await write(name, await readFile(new URL(`deploy/mac/${name}`, root)));
  }
  const secret = () => randomBytes(32).toString('hex');
  const values = {
    POSTGRES_USER: 'sekereagle',
    POSTGRES_PASSWORD: secret(),
    MINIO_ROOT_USER: 'sekereagle-nas-root',
    MINIO_ROOT_PASSWORD: secret(),
    S3_ACCESS_KEY_ID: 'sekereagle-nas-app',
    S3_SECRET_ACCESS_KEY: secret(),
    JWT_ACCESS_SECRET: secret(),
    MLX_EMBEDDING_TOKEN: secret(),
  };
  await write(
    '.env',
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  await write('owner-marker', `${project}\n`);
  await write(
    'release.json',
    JSON.stringify({ project, revision, origin, architecture: 'linux/amd64' }, null, 2),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , directory, revision] = process.argv;
  if (!directory || !revision)
    throw new Error('Usage: node scripts/deploy-nas.mjs NEW_DIRECTORY COMMIT_SHA');
  await prepareNasPackage(resolve(directory), revision);
  process.stdout.write(
    'Prepared isolated NAS configuration; credentials saved privately, no services changed.\n',
  );
}
