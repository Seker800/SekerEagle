import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const template = await readFile(
  join(root, 'deploy/mac/com.sekereagle.mlx-embedding.plist.template'),
  'utf8',
);
const launchAgents = join(homedir(), 'Library/LaunchAgents');
const target = join(launchAgents, 'com.sekereagle.mlx-embedding.plist');
await mkdir(join(root, '.runtime'), { recursive: true });
await mkdir(launchAgents, { recursive: true });
await writeFile(target, template.replaceAll('__REPO_ROOT__', root), { encoding: 'utf8', mode: 0o600 });
const domain = `gui/${process.getuid()}`;
await run('launchctl', ['bootout', domain, target]).catch(() => undefined);
await run('launchctl', ['bootstrap', domain, target]);
await run('launchctl', ['enable', `${domain}/com.sekereagle.mlx-embedding`]);
process.stdout.write('Installed and started the SekerEagle MLX launch agent\n');
