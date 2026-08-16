import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');

void test('账号页提供完整的修改密码入口', () => {
  assert.match(appSource, /\/api\/auth\/me\/password/);
  assert.match(appSource, /当前密码/);
  assert.match(appSource, /新密码/);
  assert.match(appSource, /确认新密码/);
  assert.match(appSource, /autoComplete="current-password"/);
  assert.match(appSource, /autoComplete="new-password"/);
});
