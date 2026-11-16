import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('sekereagle-invalid-password', BCRYPT_ROUNDS);
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_MAX_DELAY_MS = 60_000;
const loginFailures = new Map<string, { count: number; firstAt: number; until: number }>();

/** Consecutive password failures back off per normalized email; this is not a request quota. */
function loginDelayRemaining(email: string): number {
  const entry = loginFailures.get(email);
  return entry && entry.until > Date.now() ? entry.until - Date.now() : 0;
}

function recordLoginFailure(email: string): void {
  const now = Date.now();
  const current = loginFailures.get(email);
  const entry =
    current && now - current.firstAt < LOGIN_FAILURE_WINDOW_MS
      ? current
      : { count: 0, firstAt: now, until: 0 };
  entry.count++;
  if (entry.count >= LOGIN_LOCK_THRESHOLD)
    entry.until =
      now + Math.min(LOGIN_MAX_DELAY_MS, 1_000 * 2 ** (entry.count - LOGIN_LOCK_THRESHOLD));
  if (loginFailures.size >= 1_024 && !loginFailures.has(email))
    loginFailures.delete(loginFailures.keys().next().value!);
  loginFailures.set(email, entry);
}

@Injectable()
export class PasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string): Promise<User> {
    const normalized = normalizeEmail(email);
    if (loginDelayRemaining(normalized) > 0)
      throw new UnauthorizedException('登录尝试过于频繁，请稍后再试。');
    let user: User | null;
    try {
      user = await this.prisma.user.findUnique({ where: { email: normalized } });
      if (user) {
        if (!(await bcrypt.compare(password, user.passwordHash)))
          throw new UnauthorizedException('邮箱或密码错误。');
      } else {
        await bcrypt.compare(password, DUMMY_HASH);
        throw new UnauthorizedException('邮箱或密码错误。');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) recordLoginFailure(normalized);
      throw error;
    }
    loginFailures.delete(normalized);
    if (user.disabledAt) throw new ForbiddenException('该账号已停用。');
    return user;
  }

  async createUser(email: string, password: string, role: UserRole): Promise<User> {
    assertNewPassword(password);
    const normalized = normalizeEmail(email);
    if (await this.prisma.user.findUnique({ where: { email: normalized }, select: { id: true } })) {
      throw new ConflictException('邮箱已存在。');
    }
    try {
      return await this.prisma.user.create({
        data: {
          email: normalized,
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
          role,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('邮箱已存在。');
      }
      throw error;
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    assertNewPassword(newPassword);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在。');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('当前密码错误。');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('新密码不能与当前密码相同。');
    }
    await this.replacePasswordAndRevokeCredentials(userId, newPassword);
  }

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    assertNewPassword(newPassword);
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('用户不存在。');
    await this.replacePasswordAndRevokeCredentials(userId, newPassword);
  }

  async setDisabled(userId: string, disabled: boolean): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('用户不存在。');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { disabledAt: disabled ? now : null, authVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.personalAccessToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  async assertAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, disabledAt: true },
    });
    if (!user || user.disabledAt || user.role !== UserRole.ADMIN)
      throw new ForbiddenException('需要管理员权限。');
  }

  private async replacePasswordAndRevokeCredentials(
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const now = new Date();
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, authVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.personalAccessToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertNewPassword(password: string): void {
  if (Buffer.byteLength(password, 'utf8') > 72)
    throw new BadRequestException('密码不能超过 72 个 UTF-8 字节。');
}
