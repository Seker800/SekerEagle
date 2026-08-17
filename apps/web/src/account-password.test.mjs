import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const accountSource = await readFile(
  new URL('./components/account/AccountHome.tsx', import.meta.url),
  'utf8',
);

void test('账号页提供完整的修改密码入口', () => {
  assert.match(accountSource, /\/api\/auth\/me\/password/);
  assert.match(accountSource, /当前密码/);
  assert.match(accountSource, /新密码/);
  assert.match(accountSource, /确认新密码/);
  assert.match(accountSource, /autoComplete="current-password"/);
  assert.match(accountSource, /autoComplete="new-password"/);
});

void test('账号页提供令牌列表、创建、复制与撤销能力', () => {
  assert.match(accountSource, /request<PersonalAccessToken\[]>\('\/api\/tokens'\)/);
  assert.match(accountSource, /创建令牌/);
  assert.match(accountSource, /navigator\.clipboard\.writeText/);
  assert.match(accountSource, /method: 'DELETE'/);
});
