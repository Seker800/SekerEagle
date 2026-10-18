import { fileURLToPath } from 'node:url';
import { checkLibrarySharing, readLibrarySources } from './library-sharing.mjs';

const errors = checkLibrarySharing(
  readLibrarySources(fileURLToPath(new URL('../../', import.meta.url))),
);
for (const error of errors)
  process.stderr.write(`${error.file} [${error.rule}] ${error.message}\n`);
if (errors.length) process.exitCode = 1;
else process.stdout.write('Library sharing architecture gate passed.\n');
