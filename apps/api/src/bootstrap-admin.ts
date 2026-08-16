import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AppModule } from './app.module';
import { PasswordService } from './auth/password.service';
import { PrismaService } from './prisma/prisma.service';

async function bootstrapAdmin(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase() ?? '';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error('BOOTSTRAP_ADMIN_USERNAME 格式无效');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD 必须为 12-128 个字符');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    if ((await prisma.user.count()) !== 0) {
      throw new Error('数据库已经存在用户，拒绝再次执行管理员 bootstrap');
    }
    const user = await app.get(PasswordService).createUser(username, password, UserRole.ADMIN);
    process.stdout.write(`Created SekerEagle admin: ${user.username} (${user.id})\n`);
  } finally {
    await app.close();
  }
}

void bootstrapAdmin();
