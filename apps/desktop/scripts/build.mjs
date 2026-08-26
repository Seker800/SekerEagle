import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs' }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.cjs' }),
  build({ ...common, entryPoints: ['src/utility/entry.ts'], outfile: 'dist/utility.cjs' }),
]);

await cp('src/connection-page', 'dist/connection-page', { recursive: true });
await cp('../web/src/assets/seker-eagle-logo.svg', 'dist/connection-page/seker-eagle-logo.svg');
await cp('build/icon.png', 'dist/drag-icon.png');
