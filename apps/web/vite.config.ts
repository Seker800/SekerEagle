import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sekereagle/eagle-filter-core': fileURLToPath(
        new URL('../../packages/eagle-filter-core/src/index.ts', import.meta.url),
      ),
    },
  },
  server: { port: 4173 },
});
