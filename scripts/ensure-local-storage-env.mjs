import { randomBytes } from 'node:crypto';
import { readFile, open, rename, rm, lstat } from 'node:fs/promises';

// Never rotate a valid existing application identity or touch the root credentials.
export function withApplicationStorageCredentials(
  contents,
  createSecret = () => randomBytes(32).toString('base64url'),
) {
  const values = new Map(
    contents
      .split(/\r?\n/u)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/gu, '')];
      }),
  );
  const valid =
    values.get('S3_ACCESS_KEY_ID') &&
    values.get('S3_ACCESS_KEY_ID') !== values.get('MINIO_ROOT_USER') &&
    (values.get('S3_SECRET_ACCESS_KEY')?.length ?? 0) >= 20 &&
    values.get('S3_SECRET_ACCESS_KEY') !== values.get('MINIO_ROOT_PASSWORD') &&
    !['compose-only', 'replace-me'].includes(values.get('S3_ACCESS_KEY_ID'));
  if (valid) return contents;
  const retained = contents
    .split(/\r?\n/u)
    .filter((line) => !/^S3_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)=/u.test(line))
    .join('\n')
    .trimEnd();
  return `${retained}\nS3_ACCESS_KEY_ID=sekereagle-app-${createSecret().slice(0, 16)}\nS3_SECRET_ACCESS_KEY=${createSecret()}\n`;
}
export async function ensureLocalStorageEnvironment(path) {
  if ((await lstat(path)).isSymbolicLink())
    throw new Error('Refusing a symlink for the private environment');
  const original = await readFile(path, 'utf8');
  const next = withApplicationStorageCredentials(original);
  if (next !== original) {
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(next);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
