import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from './auth.constants';
import type { AuthPrincipal, BrowserSession } from './auth.types';

interface AccessPayload {
  sub: string;
  email: string;
  role: User['role'];
  authVersion: number;
  kind: 'browser';
}

@Injectable()
export class SessionTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async createSession(user: User): Promise<BrowserSession> {
    if (user.disabledAt) throw new ForbiddenException('该账号已停用。');
    const refreshToken = `sea_refresh_${randomBytes(32).toString('base64url')}`;
    const refreshTtl = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_SECONDS');
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hash(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });
    return {
      accessToken: await this.signAccessToken(user),
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

    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    if (rotated.count !== 1) throw new UnauthorizedException('刷新令牌已被使用。');
    return this.createSession(stored.user);
  }

  async revoke(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
  }

  async verifyAccessToken(token: string): Promise<AuthPrincipal> {
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException('访问令牌无效或已过期。');
    }
    if (payload.kind !== 'browser' || !Number.isInteger(payload.authVersion)) {
      throw new UnauthorizedException('访问令牌类型无效。');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.disabledAt || user.authVersion !== payload.authVersion) {
      throw new UnauthorizedException('登录状态已失效。');
    }
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

  private signAccessToken(user: User): Promise<string> {
    const payload: AccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion,
      kind: 'browser',
    };
    return this.jwt.signAsync(payload);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
