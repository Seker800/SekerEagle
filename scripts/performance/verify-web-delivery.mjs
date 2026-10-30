import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';

// Isolated HTTP fixtures; no database, credentials, production container or volume.
const suffix = randomUUID();
const network = `sekereagle-delivery-${suffix}`;
const temp = mkdtempSync(join(tmpdir(), 'sekereagle-delivery-'));
const containers = [];
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
  return result.stdout.trim();
}
function start(role, args) {
  const name = `${network}-${role}`;
  docker('run', '-d', '--rm', '--name', name, '--network', network, ...args);
  containers.push(name);
  return name;
}
function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path, headers, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('HTTP timeout')));
  });
}
try {
  writeFileSync(join(temp, 'fixture.conf'), `
server { listen 3000; listen 9000; root /fixtures;
  location /api/ { default_type application/json; try_files /payload.json =404; }
  location /media/ { default_type image/jpeg; try_files /image.jpg =404; }
  location /sekereagle-assets/ { default_type application/octet-stream; try_files /payload.json =404; }
}`);
  writeFileSync(join(temp, 'payload.json'), JSON.stringify({ items: Array.from({ length: 300 }, (_, id) => ({ id, name: 'synthetic library asset' })) }));
  writeFileSync(join(temp, 'image.jpg'), Buffer.alloc(4096, 42));
  docker('network', 'create', network);
  start('fixture', ['--network-alias', 'api', '--network-alias', 'minio', '-v', `${temp}:/fixtures:ro`, '-v', `${join(temp, 'fixture.conf')}:/etc/nginx/conf.d/default.conf:ro`, 'nginx:stable-alpine']);
  start('web', ['--network-alias', 'web', '-v', `${resolve('apps/web/dist')}:/usr/share/nginx/html:ro`, '-v', `${resolve('apps/web/nginx.conf')}:/etc/nginx/conf.d/default.conf:ro`, 'nginx:stable-alpine']);
  const gateway = start('gateway', ['-p', '127.0.0.1::8080', '-v', `${resolve('deploy/gateway/nginx.conf')}:/etc/nginx/conf.d/default.conf:ro`, 'nginx:stable-alpine']);
  const port = Number(docker('port', gateway, '8080').split(':').at(-1));
  let shell;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { shell = await get(port, '/'); if (shell.status === 200) break; } catch { /* startup */ }
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.equal(shell?.status, 200);
  const entry = shell.body.toString().match(/src="([^"]+\.js)"/u)?.[1];
  assert.ok(entry);
  const measurements = [];
  for (const path of [entry, '/api/fixtures']) {
    const plain = await get(port, path, { 'Accept-Encoding': 'identity' });
    const zipped = await get(port, path, { 'Accept-Encoding': 'gzip' });
    assert.equal(zipped.status, 200);
    assert.equal(zipped.headers['content-encoding'], 'gzip', `${path} should be compressed`);
    assert.match(zipped.headers.vary, /Accept-Encoding/iu);
    assert.deepEqual(gunzipSync(zipped.body), plain.body);
    assert.ok(zipped.body.length < plain.body.length * 0.6);
    measurements.push({ path: path.startsWith('/assets/') ? 'login JS' : path, rawBytes: plain.body.length, gzipBytes: zipped.body.length });
  }
  const media = await get(port, '/media/fixture', { 'Accept-Encoding': 'gzip', Range: 'bytes=0-99' });
  assert.equal(media.status, 206);
  assert.equal(media.headers['content-encoding'], undefined);
  assert.equal(media.body.length, 100);
  assert.equal((await get(port, '/missing/spa/route')).headers['cache-control'], 'no-cache');
  console.log(JSON.stringify({ measurements, mediaRange: 'passed', spaRevalidation: 'passed' }, null, 2));
} finally {
  for (const name of containers.reverse()) spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 15000 });
  spawnSync('docker', ['network', 'rm', network], { encoding: 'utf8', timeout: 15000 });
  rmSync(temp, { recursive: true, force: true });
}
