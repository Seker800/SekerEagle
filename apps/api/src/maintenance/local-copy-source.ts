import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';

export type FrozenSource = {
  path: string; size: number; mtime_ns: string; inode: string; device: string;
};

export async function assertFrozenSource(file: FileHandle, row: FrozenSource): Promise<void> {
  const s = await file.stat({ bigint: true });
  if (!s.isFile() || s.size.toString() !== String(row.size) || s.mtimeNs.toString() !== row.mtime_ns ||
      s.ino.toString() !== row.inode || s.dev.toString() !== row.device)
    throw new Error('SOURCE_CHANGED');
}

export async function openFrozenSource(row: FrozenSource, root = '/source'): Promise<FileHandle> {
  const parts = row.path.split('/');
  if (!row.path || parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f]/.test(p)))
    throw new Error('SOURCE_PATH_INVALID');
  let directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await open(`/proc/self/fd/${directory.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close(); directory = next;
    }
    const file = await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await assertFrozenSource(file, row); return file; }
    catch (error) { await file.close(); throw error; }
  } finally { await directory.close(); }
}
