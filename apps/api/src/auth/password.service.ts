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

@Injectable()
export class PasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string): Promise<User> {
    const normalized = normalizeEmail(email);
    let user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (user) {
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        throw new UnauthorizedException('邮箱或密码错误。');
      }
    } else {
      user = await this.claimSoleLegacyAdminEmail(normalized, password);
      if (!user) throw new UnauthorizedException('邮箱或密码错误。');
    }
    if (user.disabledAt) throw new ForbiddenException('该账号已停用。');
    return user;
  }

  async createUser(email: string, password: string, role: UserRole): Promise<User> {
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

  private async claimSoleLegacyAdminEmail(email: string, password: string): Promise<User | null> {
    const candidates = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, disabledAt: null, email: { not: { contains: '@' } } },
      take: 2,
    });
    if (candidates.length !== 1) {
      await bcrypt.compare(password, DUMMY_HASH);
      return null;
    }
    const [legacyAdmin] = candidates;
    if (!legacyAdmin || !(await bcrypt.compare(password, legacyAdmin.passwordHash))) return null;
    const now = new Date();
    try {
      const claimed = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.user.updateMany({
          where: {
            id: legacyAdmin.id,
            email: legacyAdmin.email,
            role: UserRole.ADMIN,
            disabledAt: null,
          },
          data: { email, authVersion: { increment: 1 } },
        });
        if (updated.count !== 1) return null;
        await Promise.all([
          transaction.refreshToken.updateMany({
            where: { userId: legacyAdmin.id, revokedAt: null },
            data: { revokedAt: now },
          }),
          transaction.personalAccessToken.updateMany({
            where: { userId: legacyAdmin.id, revokedAt: null },
            data: { revokedAt: now },
          }),
        ]);
        return transaction.user.findUnique({ where: { id: legacyAdmin.id } });
      });
      return claimed;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
