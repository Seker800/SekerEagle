import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

void test('ESLint 对 React TSX 应用类型感知规则', async () => {
  const eslint = new ESLint({ cwd: repositoryRoot });
  const config = await eslint.calculateConfigForFile('apps/web/src/App.tsx');

  assert.ok(config, 'App.tsx 应当被 ESLint 配置覆盖');
  assert.deepEqual(config.rules?.['@typescript-eslint/no-floating-promises'], [2]);
  assert.deepEqual(config.rules?.['@typescript-eslint/no-misused-promises'], [2]);
});
