import { chmod, mkdir, statfs } from 'node:fs/promises';
import path from 'node:path';

export async function availableBytesForPath(targetPath: string): Promise<number> {
  let candidate = path.resolve(targetPath);
  for (;;) {
    try {
      const fileSystem = await statfs(candidate);
      return Number(fileSystem.bavail) * Number(fileSystem.bsize);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function ensureCacheDirectory(cacheRoot: string): Promise<void> {
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await chmod(cacheRoot, 0o700);
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
