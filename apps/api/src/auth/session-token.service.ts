import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type User } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from './auth.constants';
import type { AuthPrincipal, BrowserSession } from './auth.types';

interface AccessPayload {
  sub: string;
  email: string;
  role: User['role'];
  authVersion: number;
  kind: 'browser';
  sessionFamilyId?: string;
}

@Injectable()
export class SessionTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async createSession(
    user: User,
    familyId: string = randomUUID(),
    client: Pick<Prisma.TransactionClient, 'refreshToken'> = this.prisma,
  ): Promise<BrowserSession> {
    if (user.disabledAt) throw new ForbiddenException('该账号已停用。');
    const refreshToken = `sea_refresh_${randomBytes(32).toString('base64url')}`;
    const refreshTtl = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_SECONDS');
    await client.refreshToken.create({
      data: {
        tokenHash: this.hash(refreshToken),
        familyId,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });
    return {
      accessToken: await this.signAccessToken(user, familyId),
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async refreshSession(refreshToken: string): Promise<BrowserSession> {
    const tokenHash = this.hash(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException(`${REFRESH_COOKIE_NAME} 无效或已过期。`);
    }
    if (stored.user.disabledAt) throw new ForbiddenException('该账号已停用。');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${stored.familyId}, 7432))`,
      );
      const rotated = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      });
      if (rotated.count !== 1) throw new UnauthorizedException('刷新令牌已被使用。');
      return this.createSession(stored.user, stored.familyId, tx);
    });
  }

  async revoke(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(refreshToken) },
    });
    if (!stored) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${stored.familyId}, 7432))`,
      );
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      });
    });
  }

  async verifyAccessToken(token: string): Promise<AuthPrincipal> {
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException('访问令牌无效或已过期。');
    }
    if (
      payload.kind !== 'browser' ||
      !Number.isInteger(payload.authVersion) ||
      !payload.sessionFamilyId
    ) {
      throw new UnauthorizedException('访问令牌类型无效。');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.disabledAt || user.authVersion !== payload.authVersion) {
      throw new UnauthorizedException('登录状态已失效。');
    }
    const active = await this.prisma.refreshToken.findFirst({
      where: {
        userId: user.id,
        familyId: payload.sessionFamilyId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!active) throw new UnauthorizedException('登录会话已退出。');
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion,
      kind: 'browser',
      scopes: [],
      canViewPrivate: false,
      privacyVisibleUntil: null,
    };
  }

  private signAccessToken(user: User, familyId: string): Promise<string> {
    const payload: AccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion,
      kind: 'browser',
      sessionFamilyId: familyId,
    };
    return this.jwt.signAsync(payload);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
