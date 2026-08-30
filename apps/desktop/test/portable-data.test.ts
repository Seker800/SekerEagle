import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  portableCacheRoot,
  portableProfileRoot,
  preparePortableDataRoot,
  resolvePortableDataRoot,
} from '../src/main/portable-data';

describe('Windows portable data', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it('activates only for an electron-builder Windows portable executable', () => {
    expect(
      resolvePortableDataRoot('darwin', { PORTABLE_EXECUTABLE_DIR: 'C:\\Portable' }),
    ).toBeNull();
    expect(resolvePortableDataRoot('win32', {})).toBeNull();
    expect(
      resolvePortableDataRoot('win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\Portable\\SekerEagle' }),
    ).toBe('C:\\Portable\\SekerEagle\\SekerEagleData');
    expect(() => resolvePortableDataRoot('win32', { PORTABLE_EXECUTABLE_DIR: 'relative' })).toThrow(
      '绝对路径',
    );
  });

  it('keeps the profile and media cache beside the executable and verifies writability', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-portable-'));
    temporaryRoots.push(root);
    const dataRoot = path.join(root, 'SekerEagleData');

    preparePortableDataRoot(dataRoot, 42);

    expect(existsSync(dataRoot)).toBe(true);
    expect(existsSync(path.join(dataRoot, 'Profile'))).toBe(true);
    expect(existsSync(path.join(dataRoot, 'MediaCache', 'v2'))).toBe(true);
    expect(existsSync(path.join(dataRoot, '.write-test-42'))).toBe(false);
    expect(portableProfileRoot(dataRoot)).toBe(path.join(dataRoot, 'Profile'));
    expect(portableCacheRoot(dataRoot)).toBe(path.join(dataRoot, 'MediaCache', 'v2'));
  });

  it('fails instead of falling back when the portable data root cannot be a directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-portable-blocked-'));
    temporaryRoots.push(root);
    const blockedRoot = path.join(root, 'SekerEagleData');
    await writeFile(blockedRoot, 'blocked');

    expect(() => preparePortableDataRoot(blockedRoot)).toThrow();
  });
});
