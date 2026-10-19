import { writeFile, rename, readFile } from 'node:fs/promises';

const path = '/tmp/sekereagle-worker-heartbeat.json';
export function heartbeatIsFresh(value: { pid?: unknown; at?: unknown }, now = Date.now()) {
  return (
    Number.isInteger(value.pid) &&
    typeof value.at === 'number' &&
    value.at <= now &&
    now - value.at < 45_000
  );
}
export async function recordWorkerHeartbeat() {
  await writeFile(`${path}.tmp`, JSON.stringify({ pid: process.pid, at: Date.now() }), {
    mode: 0o600,
  });
  await rename(`${path}.tmp`, path);
}
if (process.argv.includes('--check')) {
  void readFile(path, 'utf8')
    .then((text) => {
      const value = JSON.parse(text) as { pid?: number; at?: number };
      if (!heartbeatIsFresh(value)) throw new Error('WORKER_HEARTBEAT_STALE');
      process.kill(value.pid!, 0);
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
