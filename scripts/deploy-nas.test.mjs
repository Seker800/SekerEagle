import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const base = yaml.load(
  await readFile(new URL('../deploy/mac/docker-compose.yml', import.meta.url), 'utf8'),
);

async function render(options = {}) {
  const { createNasStagingCompose } = await import('./deploy-nas.mjs');
  return createNasStagingCompose(base, { revision: 'f8e4864739a9', ...options });
}

test('NAS staging isolates database, storage, network publishing and architecture', async () => {
  const original = JSON.stringify(base);
  const result = await render();
  assert.equal(JSON.stringify(base), original);
  assert.equal(result.name, 'sekereagle-nas-staging');
  assert.equal(result.services.postgres.environment.POSTGRES_DB, 'sekereagle_test');
  for (const [name, service] of Object.entries(result.services)) {
    assert.equal(service.platform, 'linux/amd64', name);
    assert.equal(service.build, undefined, name);
    assert.equal(service.container_name, undefined, name);
    if (name !== 'gateway') assert.equal(service.ports, undefined, name);
  }
  assert.deepEqual(result.services.gateway.ports, ['192.168.31.146:8181:8080']);
  for (const volume of Object.values(result.volumes)) assert.equal(volume.name, undefined);
});

test('NAS uses matching signed upload host and no Mac runtime mounts', async () => {
  const result = await render();
  for (const name of ['api', 'worker', 'migrate']) {
    const env = result.services[name].environment;
    assert.match(env.DATABASE_URL, /@postgres:5432\/sekereagle_test\?/u);
    assert.equal(env.CANONICAL_ORIGIN, 'http://localhost:8181');
    assert.equal(env.S3_PUBLIC_ENDPOINT, env.CANONICAL_ORIGIN);
    assert.equal(env.S3_ENDPOINT, 'http://minio:9000');
    assert.equal(env.S3_BUCKET, 'sekereagle-assets');
    assert.equal(env.MLX_EMBEDDING_URL, 'http://127.0.0.1:11435');
    assert.equal(env.OLLAMA_URL, 'http://127.0.0.1:11434');
  }
  assert.equal(result.services.api.volumes, undefined);
  assert.deepEqual(result.services.worker.profiles, ['processing']);
  const { createNasGateway } = await import('./deploy-nas.mjs');
  const gateway = createNasGateway(
    await readFile(new URL('../deploy/gateway/nginx.conf', import.meta.url), 'utf8'),
  );
  assert.match(gateway, /proxy_set_header Host localhost:8181;/u);
  assert.doesNotMatch(gateway, /localhost:8180/u);
});

test('NAS package only accepts immutable source revisions and bounded memory', async () => {
  for (const revision of ['', 'latest', '../../evil', 'a;touch x', '123']) {
    await assert.rejects(render({ revision }), /revision/u);
  }
  const result = await render();
  assert.equal(result.services.worker.mem_limit, '2g');
  assert.equal(result.services.worker.environment.EAGLE_INTERACTIVE_CONCURRENCY, '1');
  assert.equal(result.services.api.mem_limit, '1g');
  assert.equal(result.services.minio.mem_limit, '1g');
  assert.equal(result.services.web.healthcheck.test.at(-1), 'http://127.0.0.1:8080/');
});

test('NAS storage does not depend on removed vendor registry images', async () => {
  const result = await render();
  assert.equal(result.services.minio.image, 'sekereagle/minio:nas-20250422');
  assert.equal(result.services['minio-init'].image, 'sekereagle/mc:nas-20250416');
  assert.equal(result.services.minio.healthcheck.test[1], 'wget');
  for (const name of ['minio', 'mc']) {
    const dockerfile = await readFile(
      new URL(`../deploy/nas/${name}.Dockerfile`, import.meta.url),
      'utf8',
    );
    assert.match(dockerfile, /git fetch --depth=1 origin [a-f0-9]{40}/u);
    assert.match(dockerfile, /CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1/u);
    assert.match(dockerfile, /USER 1000:1000/u);
  }
});

test('package preparation creates private new credentials and never overwrites an install', async () => {
  const { prepareNasPackage, createNasGateway } = await import('./deploy-nas.mjs');
  const temporary = await mkdtemp(join(tmpdir(), 'eagle-nas-'));
  try {
    const first = join(temporary, 'first');
    const second = join(temporary, 'second');
    await prepareNasPackage(first, 'f8e4864739a9');
    await prepareNasPackage(second, 'f8e4864739a9');
    const env = await readFile(join(first, '.env'), 'utf8');
    assert.notEqual(env, await readFile(join(second, '.env'), 'utf8'));
    assert.equal((await stat(first)).mode & 0o777, 0o700);
    assert.equal((await stat(join(first, '.env'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(first, 'nginx.conf'))).mode & 0o777, 0o644);
    const rendered = yaml.load(await readFile(join(first, 'compose.yml'), 'utf8'));
    assert.equal(rendered.services.api.environment.CANONICAL_ORIGIN, 'http://localhost:8181');
    await assert.rejects(prepareNasPackage(first, 'f8e4864739a9'), /EEXIST/u);
    assert.equal(await readFile(join(first, '.env'), 'utf8'), env);
    assert.throws(() => createNasGateway('unexpected gateway'), /contract changed/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
