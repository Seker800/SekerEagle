import assert from 'node:assert/strict';
import test from 'node:test';
import * as bcrypt from 'bcrypt';
import { PasswordService } from './password.service';

function serviceFor(email: string, password: string) {
  const user = {
    id: 'user',
    email,
    passwordHash: bcrypt.hashSync(password, 4),
    role: 'ADMIN',
    disabledAt: null,
    authVersion: 1,
  };
  return new PasswordService({
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        where.email === email ? user : null,
      findMany: async () => [],
    },
  } as never);
}

test('consecutive password failures back off without revealing whether the email exists', async () => {
  const email = 'backoff-one@example.test';
  const service = serviceFor(email, 'correct');
  for (let attempt = 0; attempt < 5; attempt++)
    await assert.rejects(service.login(email, 'wrong'), /邮箱或密码错误/);
  await assert.rejects(service.login(email, 'correct'), /过于频繁/);
});

test('a successful login resets consecutive failures', async () => {
  const email = 'backoff-two@example.test';
  const service = serviceFor(email, 'correct');
  for (let attempt = 0; attempt < 4; attempt++)
    await assert.rejects(service.login(email, 'wrong'), /邮箱或密码错误/);
  await assert.doesNotReject(service.login(email, 'correct'));
  for (let attempt = 0; attempt < 5; attempt++)
    await assert.rejects(service.login(email, 'wrong'), /邮箱或密码错误/);
  await assert.rejects(service.login(email, 'correct'), /过于频繁/);
});
