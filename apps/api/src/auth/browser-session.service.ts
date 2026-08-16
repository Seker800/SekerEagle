import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from './auth.constants';
import type { BrowserSession } from './auth.types';

@Injectable()
export class BrowserSessionService {
  constructor(private readonly config: ConfigService) {}

  write(response: Response, session: BrowserSession): void {
    response.cookie(ACCESS_COOKIE_NAME, session.accessToken, {
      ...this.options(),
      path: '/',
      maxAge: this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS') * 1000,
    });
    response.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
      ...this.options(),
      path: '/api/auth',
      maxAge: this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_SECONDS') * 1000,
    });
  }

  clear(response: Response): void {
    response.clearCookie(ACCESS_COOKIE_NAME, { ...this.options(), path: '/' });
    response.clearCookie(REFRESH_COOKIE_NAME, { ...this.options(), path: '/api/auth' });
  }

  refreshToken(request: Request): string | undefined {
    return request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  }

  private options() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: this.config.getOrThrow<string>('CANONICAL_ORIGIN').startsWith('https://'),
    };
  }
}
