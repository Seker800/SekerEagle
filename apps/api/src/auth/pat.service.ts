import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PAT_PREFIX } from './auth.constants';
import { PAT_SCOPES, type AuthPrincipal, type PatScope } from './auth.types';

@Injectable()
export class PatService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string, scopes: PatScope[], expiresInDays: number) {
    const uniqueScopes = [...new Set(scopes)];
    if (uniqueScopes.some((scope) => !PAT_SCOPES.includes(scope))) {
      throw new BadRequestException('PAT scope 不受支持。');
    }
    const token = `${PAT_PREFIX}${randomBytes(32).toString('base64url')}`;
    const record = await this.prisma.personalAccessToken.create({
      data: {
        userId,
        name,
        scopes: uniqueScopes,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
      },
      select: { id: true, name: true, scopes: true, expiresAt: true, createdAt: true },
    });
    return { ...record, token };
  }

  list(userId: string) {
    return this.prisma.personalAccessToken.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    await this.prisma.personalAccessToken.updateMany({
      where: { id: tokenId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async authenticate(token: string): Promise<AuthPrincipal> {
    if (!token.startsWith(PAT_PREFIX)) throw new UnauthorizedException('PAT 格式无效。');
    const record = await this.prisma.personalAccessToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt <= new Date() || record.user.disabledAt) {
      throw new UnauthorizedException('PAT 无效或已过期。');
    }
    const scopes = record.scopes.filter((scope): scope is PatScope =>
      PAT_SCOPES.includes(scope as PatScope),
    );
    await this.prisma.personalAccessToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      sub: record.user.id,
      email: record.user.email,
      role: record.user.role,
      authVersion: record.user.authVersion,
      kind: 'pat',
      scopes,
    };
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
