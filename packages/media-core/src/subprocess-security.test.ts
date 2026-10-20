import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeCameraVideo, mediaSubprocessEnvironment } from './index';

test('media tools receive a minimal environment without application secrets or loader hooks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'media-env-test-'));
  const script = join(directory, 'probe.cjs');
  const keys = [
    'FFPROBE_PATH',
    'DATABASE_URL',
    'S3_SECRET_ACCESS_KEY',
    'JWT_ACCESS_SECRET',
    'PYTHONPATH',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    await writeFile(
      script,
      `#!${process.execPath}\nif (['DATABASE_URL','S3_SECRET_ACCESS_KEY','JWT_ACCESS_SECRET','PYTHONPATH'].some(key => process.env[key])) process.exit(17);\nprocess.stdout.write(JSON.stringify({format:{format_name:'mov',duration:'1'},streams:[{codec_type:'video',codec_name:'h264',width:32,height:32}]}));\n`,
    );
    await chmod(script, 0o700);
    process.env.FFPROBE_PATH = script;
    for (const key of keys.slice(1)) process.env[key] = 'synthetic-test-value';
    assert.equal((await probeCameraVideo('fixture.mp4', 'video/mp4')).durationMs, 1000);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('environment allowlist preserves explicit runtime paths and fixes native thread budgets', () => {
  const source = {
    PATH: '/usr/bin',
    TMPDIR: '/tmp',
    TMP: '/tmp',
    TEMP: '/tmp',
    SystemRoot: 'C:\\Windows',
    WINDIR: 'C:\\Windows',
    LANG: 'C',
    LC_ALL: 'C',
    PYTHONPATH: 'untrusted',
    NODE_OPTIONS: 'untrusted',
    DATABASE_URL: 'synthetic',
  };
  const safe = mediaSubprocessEnvironment(source);
  assert.equal(safe.PATH, '/usr/bin');
  assert.equal(safe.TMPDIR, '/tmp');
  assert.equal(safe.PYTHONPATH, undefined);
  assert.equal(safe.NODE_OPTIONS, undefined);
  assert.equal(safe.DATABASE_URL, undefined);
  assert.equal(safe.OMP_NUM_THREADS, '1');
  assert.deepEqual(mediaSubprocessEnvironment({}), {
    OMP_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
  });
});
