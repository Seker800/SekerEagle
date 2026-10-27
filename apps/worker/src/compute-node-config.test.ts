import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeOperations, readComputeToken, validateWindowsTokenAcl } from './compute-node-config';
test('node capabilities are explicit and cannot silently claim missing dependencies', () => {
  assert.deepEqual(nodeOperations('video,faces'), ['video', 'faces']);
  for (const input of ['', 'image,image', 'embedding', 'video,arbitrary'])
    assert.throws(() => nodeOperations(input));
});
test('private tokens reject world access and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compute-token-test-'));
  try {
    const path = join(root, 'token');
    await writeFile(path, 'isolated-test-token', { mode: 0o600 });
    assert.equal(await readComputeToken(path), 'isolated-test-token');
    await symlink(path, join(root, 'link'));
    await assert.rejects(readComputeToken(join(root, 'link')));
    await chmod(path, 0o644);
    await assert.rejects(readComputeToken(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('Windows ACL must belong to this user and exclude broad principals', () => {
  const acl = {
    owner: 'current',
    current: 'current',
    protected: true,
    allow: ['current', 'S-1-5-18', 'S-1-5-32-544'],
  };
  validateWindowsTokenAcl(acl);
  for (const invalid of [
    { ...acl, owner: 'other' },
    { ...acl, protected: false },
    { ...acl, allow: [...acl.allow, 'S-1-1-0'] },
  ])
    assert.throws(() => validateWindowsTokenAcl(invalid));
});
