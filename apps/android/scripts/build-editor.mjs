import { build } from 'vite';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../../web/', import.meta.url));
await build({
  root: web,
  configFile: `${web}vite.config.ts`,
  base: '/',
  build: {
    outDir: fileURLToPath(new URL('../app/build/generated/editor-assets/editor/', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: `${web}native-editor.html` },
  },
});
