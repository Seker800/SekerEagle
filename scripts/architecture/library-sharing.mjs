import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export function readLibrarySources(root) {
  const sources = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        sources.set(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
      }
    }
  }
  for (const directory of ['apps/web/src', 'apps/api/src/eagle', 'apps/api/src/photos']) {
    visit(join(root, directory));
  }
  return sources;
}

export function checkLibrarySharing(_sources) {
  return [];
}
