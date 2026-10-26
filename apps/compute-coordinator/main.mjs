import { setInterval, clearInterval } from 'node:timers';
import { pathToFileURL } from 'node:url';
import { Fleet, readPrivateJson } from './fleet.mjs';
import { createCoordinator, probeFleet } from './server.mjs';
export async function readSecret(path) {
  const { open, constants } = await import('node:fs/promises');
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await h.stat();
    if (
      !s.isFile() ||
      s.mode & 0o077 ||
      s.size > 1024 ||
      (process.getuid && s.uid !== process.getuid())
    )
      throw new Error('PRIVATE_CREDENTIAL_REQUIRED');
    const token = (await h.readFile('utf8')).trim();
    if (token.length < 8 || /[\r\n]/.test(token)) throw new Error('INVALID_CREDENTIAL');
    return token;
  } finally {
    await h.close();
  }
}
export async function start(env = process.env) {
  const directory = env.EAGLE_COMPUTE_STATE_DIR;
  if (!directory) throw new Error('EAGLE_COMPUTE_STATE_DIR_REQUIRED');
  const contract = {
    model: env.MLX_EMBEDDING_MODEL ?? 'Qwen/Qwen3-VL-Embedding-2B',
    revision: env.MLX_EMBEDDING_REVISION ?? '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda',
    dimensions: 1024,
  };
  const fleet = new Fleet({ directory, contract });
  await fleet.initialize();
  const executionToken = await readSecret(env.EAGLE_COMPUTE_EXECUTION_TOKEN_FILE),
    adminToken = await readSecret(env.EAGLE_COMPUTE_ADMIN_TOKEN_FILE);
  const server = createCoordinator({ fleet, executionToken, adminToken });
  await probeFleet(fleet);
  let probing = false;
  const timer = setInterval(async () => {
    if (probing) return;
    probing = true;
    try {
      await probeFleet(fleet);
    } finally {
      probing = false;
    }
  }, 5000);
  timer.unref();
  const port = Number(env.EAGLE_COMPUTE_PORT ?? 11436);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  server.listen(port, env.EAGLE_COMPUTE_BIND ?? '127.0.0.1');
  server.on('close', () => clearInterval(timer));
  const close = () => {
    clearInterval(timer);
    server.close();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  return server;
}
async function main() {
  const command = process.argv[2];
  if (command === 'serve') return start();
  if (command === 'init') {
    const config = await readPrivateJson(process.argv[3]);
    const fleet = new Fleet({
      directory: process.env.EAGLE_COMPUTE_STATE_DIR,
      contract: config.contract,
    });
    await fleet.initialize(config.nodes);
    return;
  }
  if (command === 'enroll') {
    const input = await readPrivateJson(process.argv[3]);
    const url = process.env.EAGLE_COMPUTE_ADMIN_URL ?? 'http://127.0.0.1:11436';
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('LOOPBACK_ADMIN_REQUIRED');
    const token = await readSecret(process.env.EAGLE_COMPUTE_ADMIN_TOKEN_FILE);
    const r = await fetch(url + '/admin/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`ENROLL_FAILED_${r.status}`);
    process.stdout.write(await r.text());
    return;
  }
  throw new Error('Use serve, init <private-config>, or enroll <private-config>.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write(
      'Compute coordinator startup or operation failed; inspect local configuration.\n',
    );
    process.exitCode = 1;
  });
