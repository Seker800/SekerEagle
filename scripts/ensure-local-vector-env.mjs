import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve(process.cwd(), '.env');
const temporaryPath = `${path}.vector-update`;
const revision = '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda';
let contents = await readFile(path, 'utf8');
const additions = [];
if (!/^MLX_EMBEDDING_TOKEN=/m.test(contents))
  additions.push(`MLX_EMBEDDING_TOKEN=${randomBytes(48).toString('base64url')}`);
if (!/^MLX_EMBEDDING_REVISION=/m.test(contents)) additions.push(`MLX_EMBEDDING_REVISION=${revision}`);
if (!additions.length) {
  process.stdout.write('Private vector environment is already configured\n');
  process.exit(0);
}
contents = `${contents.trimEnd()}\n${additions.join('\n')}\n`;
await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryPath, path);
process.stdout.write('Added private MLX embedding settings without exposing their values\n');
