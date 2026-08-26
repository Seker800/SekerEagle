import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyPreparedFilesToDirectory } from '../src/main/original-file-destination';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((directory) =>
        import('node:fs/promises').then(({ rm }) =>
          rm(directory, { recursive: true, force: true }),
        ),
      ),
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-original-destination-test-'));
  temporaryRoots.push(root);
  return root;
}

describe('copyPreparedFilesToDirectory', () => {
  it('copies exact bytes without replacing an existing file', async () => {
    const root = await createRoot();
    const staging = path.join(root, 'staging');
    const destination = path.join(root, 'destination');
    await Promise.all([
      import('node:fs/promises').then(({ mkdir }) => mkdir(staging)),
      import('node:fs/promises').then(({ mkdir }) => mkdir(destination)),
    ]);
    const first = path.join(staging, 'reference.png');
    const second = path.join(staging, 'second.png');
    await writeFile(first, new Uint8Array([1, 2, 3]));
    await writeFile(second, new Uint8Array([4, 5]));
    await writeFile(path.join(destination, 'reference.png'), new Uint8Array([9]));

    const copied = await copyPreparedFilesToDirectory([first, second], destination);

    expect(copied.map((file) => path.basename(file))).toEqual(['reference (2).png', 'second.png']);
    expect(new Uint8Array(await readFile(copied[0]!))).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(await readFile(path.join(destination, 'reference.png')))).toEqual(
      new Uint8Array([9]),
    );
  });

  it('rejects an empty batch and a non-directory destination', async () => {
    const root = await createRoot();
    const file = path.join(root, 'file.txt');
    await writeFile(file, 'not a directory');

    await expect(copyPreparedFilesToDirectory([], root)).rejects.toThrow(/批量/u);
    await expect(copyPreparedFilesToDirectory([file], file)).rejects.toThrow(/文件夹/u);
  });

  it('rolls back only files created by a failed batch', async () => {
    const root = await createRoot();
    const destination = path.join(root, 'destination');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(destination));
    const first = path.join(root, 'first.png');
    const missing = path.join(root, 'missing.png');
    await writeFile(first, new Uint8Array([1]));
    await writeFile(path.join(destination, 'keep.png'), new Uint8Array([9]));

    await expect(copyPreparedFilesToDirectory([first, missing], destination)).rejects.toThrow(
      /批量下载/u,
    );

    await expect(access(path.join(destination, 'first.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(path.join(destination, 'keep.png'))).resolves.toEqual(Buffer.from([9]));
  });
});
