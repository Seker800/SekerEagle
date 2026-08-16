import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.cwd(), '.local');
const output = resolve(directory, 'bootstrap.env');
const password = `Sea-${randomBytes(24).toString('base64url')}`;

await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  await writeFile(output, `SMOKE_ADMIN_USERNAME=seker\nSMOKE_ADMIN_PASSWORD=${password}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(
    'Created private .local/bootstrap.env; delete it after changing the admin password\n',
  );
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    throw new Error('.local/bootstrap.env already exists; refusing to overwrite it');
  }
  throw error;
}
