import { readFile, lstat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { connect, createSecureContext } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import console from 'node:console';

export const RELAY_NAME = 'worker-relay.sekereagle.internal';
export const SERVICES = Object.freeze({
  database: { localPort: 21432, remotePort: 22432 },
  objects: { localPort: 21000, remotePort: 22000 },
  compute: { localPort: 21436, remotePort: 22436 },
});

export function validateTarget(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(value))
    throw new Error('INVALID_RELAY_TARGET');
  const p = value.split('.').map(Number);
  if (
    p.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    value !== p.join('.') ||
    value === '192.168.31.89' ||
    !(
      p[0] === 10 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      p[0] === 127
    )
  )
    throw new Error('INVALID_RELAY_TARGET');
  return value;
}

async function privateFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('INVALID_PRIVATE_FILE');
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    typeof process.getuid !== 'function' ||
    stat.uid !== process.getuid()
  )
    throw new Error('UNSAFE_PRIVATE_FILE');
  return readFile(path);
}

export async function loadRelayConfig(path) {
  const config = JSON.parse(await privateFile(path));
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    Object.keys(config).some((key) => !['target', 'caFile', 'certFile', 'keyFile'].includes(key))
  )
    throw new Error('INVALID_RELAY_CONFIG');
  validateTarget(config.target);
  const [ca, cert, key] = await Promise.all(
    ['caFile', 'certFile', 'keyFile'].map((name) => privateFile(config[name])),
  );
  return { target: config.target, ca, cert, key };
}

/** Byte transport only. No database/object credentials, job logic or arbitrary upstream URLs. */
export function createRelayClient({ target, ca, cert, key }, reportError = () => {}) {
  validateTarget(target);
  const secureContext = createSecureContext({ ca, cert, key, minVersion: 'TLSv1.3' });
  const connections = new Set();
  const servers = new Set();
  let stopping = false;
  const fail = (service, error) =>
    reportError({
      event: 'RELAY_CONNECTION_ERROR',
      service,
      code: typeof error?.code === 'string' ? error.code : 'TRANSPORT_ERROR',
    });

  async function listen(
    service,
    localPort = SERVICES[service]?.localPort,
    remotePort = SERVICES[service]?.remotePort,
    servername = RELAY_NAME,
  ) {
    if (stopping || !SERVICES[service]) throw new Error('INVALID_RELAY_SERVICE');
    const server = createServer({ allowHalfOpen: true }, (local) => {
      if (stopping || connections.size >= 64) {
        local.destroy();
        return;
      }
      local.pause();
      let resolveDone;
      const record = {
        local,
        upstream: null,
        done: new Promise((resolve) => {
          resolveDone = resolve;
        }),
      };
      connections.add(record);
      let localClosed = false,
        upstreamClosed = false,
        deadline;
      const release = () => {
        if (localClosed && upstreamClosed) {
          clearTimeout(deadline);
          connections.delete(record);
          resolveDone();
        }
      };
      const destroy = () => {
        local.destroy();
        record.upstream?.destroy();
      };
      local.setTimeout(1200000, destroy);
      local.on('error', (error) => {
        fail(service, error);
        destroy();
      });
      local.once('close', () => {
        localClosed = true;
        record.upstream?.destroy();
        release();
      });
      try {
        const upstream = connect({
          host: target,
          port: remotePort,
          servername,
          secureContext,
          rejectUnauthorized: true,
          allowHalfOpen: true,
        });
        record.upstream = upstream;
        deadline = setTimeout(() => {
          fail(service, { code: 'CONNECT_TIMEOUT' });
          destroy();
        }, 5000);
        deadline.unref();
        upstream.setTimeout(1200000, destroy);
        upstream.on('error', (error) => {
          fail(service, error);
          destroy();
        });
        upstream.once('close', () => {
          upstreamClosed = true;
          if (upstream.readableEnded) local.end();
          else local.destroy();
          release();
        });
        upstream.once('secureConnect', () => {
          clearTimeout(deadline);
          if (stopping || local.destroyed || !upstream.authorized) {
            destroy();
            return;
          }
          local.pipe(upstream);
          upstream.pipe(local);
        });
      } catch (error) {
        upstreamClosed = true;
        fail(service, error);
        destroy();
        release();
      }
    });
    servers.add(server);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(localPort, '127.0.0.1', resolve);
      });
    } catch (error) {
      servers.delete(server);
      server.close(() => {});
      throw error;
    }
    return server.address().port;
  }

  async function stop(graceMs = 10000) {
    stopping = true;
    const pending = [...servers].map((server) => new Promise((resolve) => server.close(resolve)));
    pending.push(...[...connections].map((record) => record.done));
    const deadline = setTimeout(() => {
      for (const record of connections) {
        record.local.destroy();
        record.upstream?.destroy();
      }
    }, graceMs);
    await Promise.all(pending);
    clearTimeout(deadline);
    servers.clear();
  }
  return {
    listen,
    stop,
    get activeCount() {
      return connections.size;
    },
  };
}

async function main() {
  const config = await loadRelayConfig(process.argv[2]);
  const relay = createRelayClient(config, (event) => console.error(JSON.stringify(event)));
  try {
    for (const service of Object.keys(SERVICES)) await relay.listen(service);
  } catch (error) {
    await relay.stop(0);
    throw error;
  }
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void relay.stop().then(() => {
      process.exitCode = 0;
    });
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  console.log(
    JSON.stringify({ event: 'SEKEREAGLE_WORKER_RELAY_READY', services: Object.keys(SERVICES) }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        event: 'SEKEREAGLE_WORKER_RELAY_FAILED',
        code: error.code ?? 'CONFIGURATION_ERROR',
      }),
    );
    process.exitCode = 1;
  });
