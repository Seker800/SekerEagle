import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const composePath = new URL('../deploy/mac/docker-compose.yml', import.meta.url);
const webDockerfilePath = new URL('../apps/web/Dockerfile', import.meta.url);

function captureVersion(contents, pattern, source) {
  const match = contents.match(pattern);
  assert.ok(match, `Unable to find the nginx image version in ${source}`);
  return match[1];
}

test('gateway and web runtime use the same nginx image version', async () => {
  const [compose, webDockerfile] = await Promise.all([
    readFile(composePath, 'utf8'),
    readFile(webDockerfilePath, 'utf8'),
  ]);

  const gatewayVersion = captureVersion(
    compose,
    /^\s+image: nginx:([^\s]+)$/m,
    'deploy/mac/docker-compose.yml',
  );
  const webRuntimeVersion = captureVersion(
    webDockerfile,
    /^FROM nginx:([^\s]+)$/m,
    'apps/web/Dockerfile',
  );

  assert.equal(webRuntimeVersion, gatewayVersion);
});

test('the root test suite includes the safe Mac deployment contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.match(manifest.scripts.test, /scripts\/deploy-mac\.test\.mjs/u);
  assert.equal(manifest.scripts['deploy:mac'], 'node ./scripts/deploy-mac.mjs');
});

test('web health check and gateway target the actual web listener', async () => {
  const [compose, webNginx, gateway] = await Promise.all([
    readFile(composePath, 'utf8'),
    readFile(new URL('../apps/web/nginx.conf', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/gateway/nginx.conf', import.meta.url), 'utf8'),
  ]);
  const port = webNginx.match(/listen\s+(\d+);/)[1];
  const web = compose.split('\n  web:')[1].split('\n  gateway:')[0];
  assert.ok(web.includes(`http://127.0.0.1:${port}/`));
  assert.ok(gateway.includes(`server web:${port} resolve;`));
});

test('geographic JSON has an explicit compressible MIME type without overriding server asset types', async () => {
  const config = await readFile(new URL('../apps/web/nginx.conf', import.meta.url), 'utf8');
  assert.match(config.split('server {')[0], /types\s*\{\s*application\/geo\+json\s+geojson;/);
  assert.match(config, /gzip_types[^;]*application\/geo\+json/);
});
