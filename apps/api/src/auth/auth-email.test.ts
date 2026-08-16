import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto';
import { PasswordService } from './password.service';

void test('登录契约接受并规范化邮箱，拒绝旧用户名格式', async () => {
  const valid = plainToInstance(LoginDto, {
    email: '  Seker@Example.COM ',
    password: 'correct-password',
  });
  assert.equal((await validate(valid)).length, 0);
  assert.equal(valid.email, 'seker@example.com');

  const invalid = plainToInstance(LoginDto, {
    email: 'seker',
    password: 'correct-password',
  });
  assert.ok((await validate(invalid)).some((error) => error.property === 'email'));
});

void test('首个邮箱登录可用原密码安全升级唯一旧管理员', async () => {
  const password = 'correct-password';
  const legacyAdmin: User = {
    id: 'legacy-admin',
    email: 'seker',
    passwordHash: await bcrypt.hash(password, 4),
    role: UserRole.ADMIN,
    authVersion: 0,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let claimedEmail = '';
  let revokedRefresh = false;
  let revokedPat = false;
  const transaction = {
    user: {
      updateMany: (input: { data: { email: string } }) => {
        claimedEmail = input.data.email;
        return Promise.resolve({ count: 1 });
      },
      findUnique: () => Promise.resolve({ ...legacyAdmin, email: claimedEmail, authVersion: 1 }),
    },
    refreshToken: {
      updateMany: () => {
        revokedRefresh = true;
        return Promise.resolve({ count: 1 });
      },
    },
    personalAccessToken: {
      updateMany: () => {
        revokedPat = true;
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const prisma = {
    user: {
      findUnique: () => Promise.resolve(null),
      findMany: () => Promise.resolve([legacyAdmin]),
    },
    $transaction: (operation: (client: typeof transaction) => Promise<User | null>) =>
      operation(transaction),
  } as unknown as PrismaService;

  const user = await new PasswordService(prisma).login('New.Owner@Example.com', password);
  assert.equal(user.email, 'new.owner@example.com');
  assert.equal(claimedEmail, 'new.owner@example.com');
  assert.equal(user.authVersion, 1);
  assert.equal(revokedRefresh, true);
  assert.equal(revokedPat, true);
});

void test('旧管理员密码错误时不会绑定邮箱', async () => {
  const legacyAdmin = {
    id: 'legacy-admin',
    email: 'seker',
    passwordHash: await bcrypt.hash('correct-password', 4),
    role: UserRole.ADMIN,
    authVersion: 0,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies User;
  let transactionStarted = false;
  const prisma = {
    user: {
      findUnique: () => Promise.resolve(null),
      findMany: () => Promise.resolve([legacyAdmin]),
    },
    $transaction: () => {
      transactionStarted = true;
      throw new Error('不应执行事务');
    },
  } as unknown as PrismaService;

  await assert.rejects(
    new PasswordService(prisma).login('attacker@example.com', 'wrong-password'),
    /邮箱或密码错误/,
  );
  assert.equal(transactionStarted, false);
});
