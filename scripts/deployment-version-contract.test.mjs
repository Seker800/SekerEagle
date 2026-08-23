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
