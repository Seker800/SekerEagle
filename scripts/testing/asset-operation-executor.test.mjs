import assert from 'node:assert/strict';
import { setTimeout, clearTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

test(
  'independent operation process needs no API secrets, declares readiness and drains on termination',
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seker-operation-executor-'));
    const ready = join(dir, 'ready');
    const child = spawn(process.execPath, [resolve('apps/api/dist/asset-operation-executor.js')], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: process.env.DATABASE_URL,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_PUBLIC_ENDPOINT: process.env.S3_ENDPOINT,
        S3_BUCKET: process.env.S3_BUCKET,
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'synthetic-only',
        S3_SECRET_ACCESS_KEY: 'synthetic-only',
        EAGLE_OPERATION_READY_FILE: ready,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    try {
      await new Promise((accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Executor did not declare readiness')),
          10000,
        );
        let text = '';
        child.stdout.on('data', (bytes) => {
          text = (text + bytes.toString()).slice(-10000);
          if (text.includes('Asset operation executor ready')) {
            clearTimeout(timer);
            accept();
          }
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Executor exited before readiness'));
        });
      });
      assert.equal(Number(await readFile(ready, 'utf8')), child.pid);
    } finally {
      child.kill('SIGTERM');
      const [code, signal] = await exited;
      await assert.rejects(readFile(ready), { code: 'ENOENT' });
      await rm(dir, { recursive: true, force: true });
      assert.equal(signal, null);
      assert.equal(code, 0);
    }
  },
);
