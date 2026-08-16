import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto } from './dto';
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

void test('修改密码契约限制密码长度', async () => {
  const valid = plainToInstance(ChangePasswordDto, {
    currentPassword: 'current-password',
    newPassword: 'new-password-123',
  });
  assert.equal((await validate(valid)).length, 0);

  const invalid = plainToInstance(ChangePasswordDto, {
    currentPassword: 'short',
    newPassword: 'short',
  });
  assert.deepEqual((await validate(invalid)).map((error) => error.property).sort(), [
    'currentPassword',
    'newPassword',
  ]);
});

void test('修改密码会更新哈希并撤销该用户的全部凭据', async () => {
  const currentPassword = 'current-password';
  const user = {
    id: 'user-1',
    email: 'owner@example.com',
    passwordHash: await bcrypt.hash(currentPassword, 4),
    role: UserRole.USER,
    authVersion: 0,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies User;
  let updatedHash = '';
  let incrementedAuthVersion = false;
  const revokedKinds: string[] = [];
  const prisma = {
    user: {
      findUnique: () => Promise.resolve(user),
      update: (input: { data: { passwordHash: string; authVersion: { increment: number } } }) => {
        updatedHash = input.data.passwordHash;
        incrementedAuthVersion = input.data.authVersion.increment === 1;
        return Promise.resolve(user);
      },
    },
    refreshToken: {
      updateMany: () => {
        revokedKinds.push('refresh');
        return Promise.resolve({ count: 1 });
      },
    },
    personalAccessToken: {
      updateMany: () => {
        revokedKinds.push('pat');
        return Promise.resolve({ count: 1 });
      },
    },
    $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as PrismaService;

  await new PasswordService(prisma).changePassword(user.id, currentPassword, 'new-password-123');

  assert.equal(await bcrypt.compare('new-password-123', updatedHash), true);
  assert.equal(incrementedAuthVersion, true);
  assert.deepEqual(revokedKinds.sort(), ['pat', 'refresh']);
});

void test('当前密码错误时不修改账号', async () => {
  const user = {
    id: 'user-1',
    email: 'owner@example.com',
    passwordHash: await bcrypt.hash('current-password', 4),
    role: UserRole.USER,
    authVersion: 0,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies User;
  let transactionStarted = false;
  const prisma = {
    user: { findUnique: () => Promise.resolve(user) },
    $transaction: () => {
      transactionStarted = true;
      throw new Error('不应执行事务');
    },
  } as unknown as PrismaService;

  await assert.rejects(
    new PasswordService(prisma).changePassword(user.id, 'wrong-password', 'new-password-123'),
    /当前密码错误/,
  );
  assert.equal(transactionStarted, false);
});
