import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORTABLE_DATA_DIRECTORY = 'SekerEagleData';

export function resolvePortableDataRoot(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): string | null {
  if (platform !== 'win32') return null;
  const executableDirectory = environment.PORTABLE_EXECUTABLE_DIR;
  if (!executableDirectory) return null;
  if (!path.win32.isAbsolute(executableDirectory)) {
    throw new Error('便携版程序目录必须是绝对路径。');
  }
  return path.win32.join(executableDirectory, PORTABLE_DATA_DIRECTORY);
}

export function preparePortableDataRoot(dataRoot: string, processId = process.pid): void {
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(portableProfileRoot(dataRoot), { recursive: true });
  mkdirSync(portableCacheRoot(dataRoot), { recursive: true });
  const probe = path.join(dataRoot, `.write-test-${processId}`);
  try {
    writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
  } finally {
    rmSync(probe, { force: true });
  }
}

export function portableProfileRoot(dataRoot: string): string {
  return path.join(dataRoot, 'Profile');
}

export function portableCacheRoot(dataRoot: string): string {
  return path.join(dataRoot, 'MediaCache', 'v2');
}
