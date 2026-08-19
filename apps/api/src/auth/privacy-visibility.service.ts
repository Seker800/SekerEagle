import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PRIVACY_VISIBILITY_COOKIE_NAME } from './auth.constants';

export const PRIVACY_VISIBILITY_DURATIONS = [1, 3, 6, 12, 24] as const;
const DEFAULT_DURATION_HOURS = 3;

interface PrivacyVisibilityClaims {
  sub: string;
  kind: 'privacy-visibility';
  exp: number;
}

export interface PrivacyVisibilityStatus {
  enabled: boolean;
  durationHours: number;
  expiresAt: string | null;
}

@Injectable()
export class PrivacyVisibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(ownerId: string, request: Request): Promise<PrivacyVisibilityStatus> {
    const [preference, expiresAt] = await Promise.all([
      this.prisma.eaglePrivacyPreference.findUnique({
        where: { ownerId },
        select: { durationHours: true },
      }),
      this.readGrant(ownerId, request),
    ]);
    return {
      enabled: expiresAt !== null,
      durationHours: preference?.durationHours ?? DEFAULT_DURATION_HOURS,
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  }

  async update(
    ownerId: string,
    response: Response,
    input: { enabled: boolean; durationHours: number },
  ): Promise<PrivacyVisibilityStatus> {
    if (!PRIVACY_VISIBILITY_DURATIONS.some((hours) => hours === input.durationHours)) {
      throw new BadRequestException('隐私内容显示时长无效。');
    }
    await this.prisma.eaglePrivacyPreference.upsert({
      where: { ownerId },
      create: { ownerId, durationHours: input.durationHours },
      update: { durationHours: input.durationHours },
    });
    if (!input.enabled) {
      response.clearCookie(PRIVACY_VISIBILITY_COOKIE_NAME, {
        ...this.cookieOptions(),
        path: '/api',
      });
      return { enabled: false, durationHours: input.durationHours, expiresAt: null };
    }
    const durationMs = input.durationHours * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + durationMs);
    const token = await this.jwt.signAsync(
      { sub: ownerId, kind: 'privacy-visibility' },
      { expiresIn: input.durationHours * 60 * 60 },
    );
    response.cookie(PRIVACY_VISIBILITY_COOKIE_NAME, token, {
      ...this.cookieOptions(),
      path: '/api',
      maxAge: durationMs,
    });
    return {
      enabled: true,
      durationHours: input.durationHours,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async readGrant(ownerId: string, request: Request): Promise<Date | null> {
    const token = request.cookies?.[PRIVACY_VISIBILITY_COOKIE_NAME] as string | undefined;
    if (!token) return null;
    try {
      const claims = await this.jwt.verifyAsync<PrivacyVisibilityClaims>(token);
      if (claims.kind !== 'privacy-visibility' || claims.sub !== ownerId) return null;
      const expiresAt = new Date(claims.exp * 1000);
      return expiresAt.getTime() > Date.now() ? expiresAt : null;
    } catch {
      return null;
    }
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: this.config.getOrThrow<string>('CANONICAL_ORIGIN').startsWith('https://'),
    };
  }
}
