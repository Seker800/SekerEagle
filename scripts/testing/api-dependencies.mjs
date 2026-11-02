import { createRequire } from 'node:module';

// Integration fixtures use the same dependency instance as the application under test.
export const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
