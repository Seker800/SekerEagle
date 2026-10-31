import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const base = yaml.load(
  await readFile(new URL('../deploy/mac/docker-compose.yml', import.meta.url), 'utf8'),
);

test('full-library face scan gets a bounded admission timeout without widening other routes', async () => {
  const gateway = await readFile(new URL('../deploy/gateway/nginx.conf', import.meta.url), 'utf8');
  const scan = gateway.match(
    /location ~ \^\/api\/photos\/\(tasks\/start\|photography\/people\/scan\)\$ \{([\s\S]*?)\n {2}\}/u,
  );
  assert.ok(scan, 'both authenticated face-scan entry points need their own bounded timeout');
  assert.match(scan[1], /proxy_pass http:\/\/api_backend;/u);
  assert.match(scan[1], /proxy_read_timeout 660s;/u);
  assert.match(scan[1], /proxy_set_header Host \$http_host;/u);
  const ordinary = gateway.match(/location \/api\/ \{([\s\S]*?)\n {2}\}/u);
  assert.match(ordinary[1], /proxy_read_timeout 15s;/u);
});

test('original-file confirmation has a bounded deadline scoped to valid upload routes', async () => {
  const gateway = await readFile(new URL('../deploy/gateway/nginx.conf', import.meta.url), 'utf8');
  const upload = gateway.match(/location ~ "([^"]+)" \{([\s\S]*?)\n {2}\}/u);
  assert.ok(upload);
  const route = new RegExp(upload[1]);
  for (const mode of ['eagle', 'photos']) {
    assert.ok(route.test(`/api/${mode}/uploads/12345678-1234-4234-8234-123456789abc/complete`));
    for (const suffix of [
      'assets',
      'uploads/bad/complete',
      'uploads/12345678-1234-4234-8234-123456789abc/parts',
    ])
      assert.equal(route.test(`/api/${mode}/${suffix}`), false);
  }
  assert.equal(route.test('/api/auth/me'), false);
  assert.match(upload[2], /proxy_read_timeout 660s;/u);
  assert.match(upload[2], /proxy_send_timeout 15s;/u);
});

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
    assert.equal(env.OLLAMA_URL, undefined);
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

test('explicit NAS search connection requires dedicated credentials and cannot enable background inference', async () => {
  const overlay = yaml.load(
    await readFile(new URL('../deploy/nas/search-inference.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(overlay), ['services']);
  assert.deepEqual(Object.keys(overlay.services), ['api']);
  assert.deepEqual(Object.keys(overlay.services.api), ['environment']);
  const env = overlay.services.api.environment;
  assert.deepEqual(Object.keys(env).sort(), ['MLX_EMBEDDING_TOKEN', 'MLX_EMBEDDING_URL']);
  assert.match(env.MLX_EMBEDDING_URL, /^\$\{NAS_SEARCH_EMBEDDING_URL:\?/u);
  assert.match(env.MLX_EMBEDDING_TOKEN, /^\$\{NAS_SEARCH_EMBEDDING_TOKEN:\?/u);
  const defaults = await render();
  assert.equal(defaults.services.worker.environment.MLX_EMBEDDING_URL, 'http://127.0.0.1:11435');
  assert.deepEqual(defaults.services.worker.profiles, ['processing']);
});

test('NAS operation executor uses the application image and isolated database without API or model secrets', async () => {
  const { services } = await render();
  const executor = services.operations;
  assert.equal(executor.image, 'sekereagle/api:nas-f8e4864739a9');
  assert.match(executor.environment.DATABASE_URL, /@postgres:5432\/sekereagle_test\?/u);
  assert.equal(executor.environment.S3_PUBLIC_ENDPOINT, 'http://minio:9000');
  assert.equal(executor.environment.JWT_SECRET, undefined);
  assert.equal(executor.environment.MLX_EMBEDDING_URL, undefined);
  assert.deepEqual(executor.command, ['node', 'apps/api/dist/asset-operation-executor.js']);
  assert.equal(executor.mem_limit, '${EAGLE_OPERATION_MEMORY_LIMIT:-512m}');
});

test('large operation admission has its own adjustable gateway deadline', async () => {
  const { createNasGateway } = await import('./deploy-nas.mjs');
  const source = await readFile(new URL('../deploy/gateway/nginx.conf', import.meta.url), 'utf8');
  const route = source.match(/location ~ (\S*operations\S*) \{([\s\S]*?)\n {2}\}/u);
  assert.ok(route, 'operation admission must not inherit the 15 second deadline');
  const pattern = new RegExp(route[1]);
  for (const mode of ['eagle', 'photos']) {
    assert.ok(pattern.test(`/api/${mode}/operations`));
    assert.ok(pattern.test(`/api/${mode}/assets/batch/send`));
  }
  assert.equal(pattern.test('/api/auth/me'), false);
  assert.match(route[2], /proxy_read_timeout 150s;/u);
  assert.match(
    createNasGateway(source, { operationTimeoutSeconds: 180 }),
    /proxy_read_timeout 180s;/u,
  );
});
