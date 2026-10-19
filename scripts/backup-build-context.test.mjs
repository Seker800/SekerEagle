import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const policy = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
test('build context uses an allowlist and excludes private runtime trees at every depth', () => {
  const rules = policy
    .trim()
    .split('\n')
    .filter((rule) => rule && !rule.startsWith('#'));
  assert.equal(rules[0], '**');
  for (const rule of ['**/.local', '**/.runtime', '**/.venv', '**/.env*', '**/node_modules']) {
    assert.ok(rules.includes(rule), `Missing exclusion: ${rule}`);
    assert.equal(
      rules.slice(rules.indexOf(rule) + 1).some((r) => r.startsWith('!')),
      false,
    );
  }
});
test('all Docker COPY inputs remain in the build allowlist', async () => {
  const rules = policy
    .trim()
    .split('\n')
    .filter((rule) => rule && !rule.startsWith('#'));
  for (const app of ['api', 'worker', 'web']) {
    const dockerfile = await readFile(
      new URL(`../apps/${app}/Dockerfile`, import.meta.url),
      'utf8',
    );
    for (const line of dockerfile
      .split('\n')
      .filter((l) => l.startsWith('COPY ') && !l.includes('--from='))) {
      const sources = line.split(/\s+/).slice(1, -1);
      for (const source of sources) {
        assert.ok(
          rules.includes(`!${source}`) ||
            rules.includes(`!${source}/**`) ||
            rules.some(
              (r) => r.startsWith('!') && r.endsWith('/**') && source.startsWith(r.slice(1, -2)),
            ),
          `Excluded COPY input: ${source}`,
        );
      }
    }
  }
});
test(
  'Docker itself excludes secret sentinels from the transmitted context',
  {
    skip: process.env.SEKEREAGLE_TEST_DOCKER_CONTEXT !== '1',
  },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), 'eagle-context-'));
    try {
      const context = join(temp, 'input');
      const output = join(temp, 'output');
      await mkdir(context);
      await writeFile(join(context, '.dockerignore'), policy);
      await writeFile(join(context, 'Dockerfile'), 'FROM scratch\nCOPY . /\n');
      const blocked = [
        '.local/backup/input/runtime.env',
        '.local/backup/input/database.dump',
        '.local/backup/repository-password',
        '.runtime/status.json',
        '.venv/key',
        'apps/api/.local/secret',
        'apps/api/.env.local',
        'packages/config/node_modules/secret',
      ];
      const allowed = ['package.json', 'apps/api/src/main.ts', 'services/photo-face/main.py'];
      for (const path of [...blocked, ...allowed]) {
        await mkdir(join(context, path, '..'), { recursive: true });
        await writeFile(join(context, path), 'non-secret test sentinel');
      }
      const result = spawnSync(
        'docker',
        ['build', '--output', `type=local,dest=${output}`, context],
        { timeout: 120_000, encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
      for (const path of blocked) await assert.rejects(access(join(output, path)));
      for (const path of allowed) await access(join(output, path));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);
