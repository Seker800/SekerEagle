import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import yaml from 'js-yaml';

const base = yaml.load(await readFile(new URL('../deploy/mac/docker-compose.yml', import.meta.url), 'utf8'));

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
    assert.equal(env.CANONICAL_ORIGIN, 'http://192.168.31.146:8181');
    assert.equal(env.S3_PUBLIC_ENDPOINT, env.CANONICAL_ORIGIN);
    assert.equal(env.S3_ENDPOINT, 'http://minio:9000');
    assert.equal(env.S3_BUCKET, 'sekereagle-assets');
    assert.equal(env.MLX_EMBEDDING_URL, 'http://127.0.0.1:11435');
    assert.equal(env.OLLAMA_URL, 'http://127.0.0.1:11434');
  }
  assert.equal(result.services.api.volumes, undefined);
  assert.deepEqual(result.services.worker.profiles, ['processing']);
  const { createNasGateway } = await import('./deploy-nas.mjs');
  const gateway = createNasGateway(await readFile(new URL('../deploy/gateway/nginx.conf', import.meta.url), 'utf8'));
  assert.match(gateway, /proxy_set_header Host 192\.168\.31\.146:8181;/u);
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
