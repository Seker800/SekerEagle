import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdtemp, writeFile, readFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:tls';
import { Buffer } from 'node:buffer';
import { connect as tcpConnect } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import {
  createRelayClient,
  validateTarget,
  loadRelayConfig,
  RELAY_NAME,
} from './business-worker-relay.mjs';

let dir, ca, cert, key, clientCert, clientKey;
function openssl(args) {
  const r = spawnSync('openssl', args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sekereagle-relay-test-'));
  await writeFile(
    join(dir, 'ca.cnf'),
    '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=synthetic-relay-test\n[v3]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n',
  );
  openssl([
    'req',
    '-new',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-keyout',
    join(dir, 'ca.key'),
    '-out',
    join(dir, 'ca.pem'),
    '-config',
    join(dir, 'ca.cnf'),
  ]);
  for (const name of ['server', 'client']) {
    const cn = name === 'server' ? RELAY_NAME : 'synthetic-worker';
    openssl([
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, name + '.key'),
      '-out',
      join(dir, name + '.csr'),
      '-subj',
      '/CN=' + cn,
    ]);
    await writeFile(
      join(dir, name + '.cnf'),
      '[v3]\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=' +
        (name === 'server' ? 'serverAuth' : 'clientAuth') +
        '\nsubjectAltName=DNS:' +
        cn +
        '\n',
    );
    openssl([
      'x509',
      '-req',
      '-in',
      join(dir, name + '.csr'),
      '-CA',
      join(dir, 'ca.pem'),
      '-CAkey',
      join(dir, 'ca.key'),
      '-CAserial',
      join(dir, 'ca.srl'),
      '-CAcreateserial',
      '-days',
      '2',
      '-sha256',
      '-extfile',
      join(dir, name + '.cnf'),
      '-extensions',
      'v3',
      '-out',
      join(dir, name + '.pem'),
    ]);
  }
  for (const name of ['ca.pem', 'server.pem', 'server.key', 'client.pem', 'client.key'])
    await chmod(join(dir, name), 0o600);
  [ca, cert, key, clientCert, clientKey] = await Promise.all(
    ['ca.pem', 'server.pem', 'server.key', 'client.pem', 'client.key'].map((name) =>
      readFile(join(dir, name)),
    ),
  );
});
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function echoServer(t) {
  const sockets = new Set();
  let bytes = 0;
  const server = createServer(
    {
      ca,
      cert,
      key,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      allowHalfOpen: true,
    },
    (socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('data', (chunk) => {
        bytes += chunk.length;
        socket.write(chunk);
      });
      socket.on('end', () => socket.end());
      socket.on('close', () => sockets.delete(socket));
    },
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('tlsClientError', (_error, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    port: server.address().port,
    get bytes() {
      return bytes;
    },
  };
}
function exchange(port, data, slow = false) {
  return new Promise((resolve, reject) => {
    const client = tcpConnect({ host: '127.0.0.1', port });
    const chunks = [];
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('exchange timeout'));
    }, 10000);
    client.on('connect', () => {
      client.end(data);
      if (slow) {
        client.pause();
        setTimeout(() => client.resume(), 200);
      }
    });
    client.on('data', (chunk) => chunks.push(chunk));
    client.on('error', () => {});
    client.on('close', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks));
    });
  });
}

test('only literal private targets and restricted owner-private config files are accepted', async () => {
  for (const ip of [
    '8.8.8.8',
    '192.168.31.89',
    'example.invalid',
    '127.0.0.1:22',
    '192.168.001.2',
    '256.1.1.1',
  ])
    assert.throws(() => validateTarget(ip));
  assert.equal(validateTarget('192.168.31.146'), '192.168.31.146');
  const config = {
    target: '127.0.0.1',
    caFile: join(dir, 'ca.pem'),
    certFile: join(dir, 'client.pem'),
    keyFile: join(dir, 'client.key'),
  };
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  assert.equal((await loadRelayConfig(file)).target, '127.0.0.1');
  await chmod(file, 0o644);
  await assert.rejects(loadRelayConfig(file), /UNSAFE_PRIVATE_FILE/);
  await chmod(file, 0o600);
  const link = join(dir, 'linked.json');
  await symlink(file, link);
  await assert.rejects(loadRelayConfig(link), /UNSAFE_PRIVATE_FILE/);
  await writeFile(file, JSON.stringify({ ...config, services: [{ remotePort: 22 }] }));
  await assert.rejects(loadRelayConfig(file), /INVALID_RELAY_CONFIG/);
});

test('mutual TLS transports binary bytes without truncation under backpressure and half-close', async (t) => {
  const server = await echoServer(t);
  const relay = createRelayClient({ target: '127.0.0.1', ca, cert: clientCert, key: clientKey });
  t.after(() => relay.stop(0));
  const port = await relay.listen('objects', 0, server.port);
  const data = randomBytes(4 * 1024 * 1024);
  const result = await exchange(port, data, true);
  assert.equal(result.length, data.length);
  assert.equal(
    createHash('sha256').update(result).digest('hex'),
    createHash('sha256').update(data).digest('hex'),
  );
});

test('wrong server identity or missing client identity never delivers backend payload', async (t) => {
  const server = await echoServer(t);
  for (const [name, identity] of [
    ['wrong.invalid', { cert: clientCert, key: clientKey }],
    [RELAY_NAME, {}],
  ]) {
    const relay = createRelayClient({ target: '127.0.0.1', ca, ...identity });
    const port = await relay.listen('database', 0, server.port, name);
    assert.equal((await exchange(port, Buffer.from('must-not-arrive'))).length, 0);
    await relay.stop(0);
  }
  assert.equal(server.bytes, 0);
});

test('a rejected TLS connection releases admission so a healthy retry succeeds', async (t) => {
  const server = await echoServer(t);
  const relay = createRelayClient({ target: '127.0.0.1', ca, cert: clientCert, key: clientKey });
  t.after(() => relay.stop(0));
  const bad = await relay.listen('database', 0, server.port, 'wrong.invalid');
  await exchange(bad, Buffer.from('bad'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(relay.activeCount, 0);
  const good = await relay.listen('objects', 0, server.port);
  assert.equal((await exchange(good, Buffer.from('healthy'))).toString(), 'healthy');
});

test('the listener binds only loopback and stop closes active connections within its deadline', async (t) => {
  const server = await echoServer(t);
  const relay = createRelayClient({ target: '127.0.0.1', ca, cert: clientCert, key: clientKey });
  const port = await relay.listen('compute', 0, server.port);
  const client = tcpConnect({ host: '127.0.0.1', port });
  client.on('error', () => {});
  await new Promise((resolve) => client.once('connect', resolve));
  assert.equal(client.remoteAddress, '127.0.0.1');
  await relay.stop(0);
  assert.equal(relay.activeCount, 0);
  client.destroy();
});

test('an untrusted server certificate cannot receive a payload', async (t) => {
  const server = await echoServer(t);
  const relay = createRelayClient({
    target: '127.0.0.1',
    ca: clientCert,
    cert: clientCert,
    key: clientKey,
  });
  t.after(() => relay.stop(0));
  const port = await relay.listen('objects', 0, server.port);
  assert.equal((await exchange(port, Buffer.from('untrusted'))).length, 0);
  assert.equal(server.bytes, 0);
});

test('connection admission is shared across the three fixed service listeners', async (t) => {
  const server = await echoServer(t);
  const relay = createRelayClient({ target: '127.0.0.1', ca, cert: clientCert, key: clientKey });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.destroy();
    await relay.stop(0);
  });
  const first = await relay.listen('database', 0, server.port);
  const second = await relay.listen('objects', 0, server.port);
  const third = await relay.listen('compute', 0, server.port);
  for (let i = 0; i < 64; i++) {
    const client = tcpConnect({ host: '127.0.0.1', port: i % 2 ? first : second });
    client.on('error', () => {});
    clients.push(client);
    await new Promise((resolve) => client.once('connect', resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(relay.activeCount, 64);
  const extra = tcpConnect({ host: '127.0.0.1', port: third });
  extra.on('error', () => {});
  await new Promise((resolve) => extra.once('close', resolve));
  assert.equal(relay.activeCount, 64);
});
