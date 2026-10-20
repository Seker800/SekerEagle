import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('MCP initializes with an owner-only PAT file and refuses shared files and symlinks without disclosing the PAT', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-pat-test-'));
  const file = join(dir, 'pat');
  const link = join(dir, 'link');
  const token = 'sea_pat_synthetic-file-test-value';
  const env = { PATH: process.env.PATH, SEKEREAGLE_AGENT_URL: 'http://127.0.0.1:8180' };
  function start(path) {
    return spawnSync(process.execPath, [new URL('./main.mjs', import.meta.url).pathname], {
      env: { ...env, SEKEREAGLE_AGENT_PAT_FILE: path },
      encoding: 'utf8',
      timeout: 5000,
      input:
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }) + '\n',
    });
  }
  try {
    await writeFile(file, `${token}\n`, { mode: 0o600 });
    const ok = start(file);
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /sekereagle-photo-agent/);
    assert.ok(!ok.stdout.includes(token) && !ok.stderr.includes(token));
    await chmod(file, 0o644);
    assert.notEqual(start(file).status, 0);
    await chmod(file, 0o600);
    await symlink(file, link);
    assert.notEqual(start(link).status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
