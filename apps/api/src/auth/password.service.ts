import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('sekereagle-invalid-password', BCRYPT_ROUNDS);

@Injectable()
export class PasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async login(username: string, password: string): Promise<User> {
    const normalized = username.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { username: normalized } });
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new UnauthorizedException('用户名或密码错误。');
    if (user.disabledAt) throw new ForbiddenException('该账号已停用。');
    return user;
  }

  async createUser(username: string, password: string, role: UserRole): Promise<User> {
    const normalized = username.trim().toLowerCase();
    if (
      await this.prisma.user.findUnique({ where: { username: normalized }, select: { id: true } })
    ) {
      throw new ConflictException('用户名已存在。');
    }
    return this.prisma.user.create({
      data: {
        username: normalized,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        role,
      },
    });
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
}
