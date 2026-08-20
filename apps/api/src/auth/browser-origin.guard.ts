import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

function resolveOrigin(request: Request): string | null {
  const origin = request.headers.origin?.trim();
  if (origin) return origin;
  const referer = request.headers.referer?.trim();
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

@Injectable()
export class BrowserOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): true {
    const request = context.switchToHttp().getRequest<Request>();
    const trustedOrigins = this.config.getOrThrow<readonly string[]>('BROWSER_TRUSTED_ORIGINS');
    if (!trustedOrigins.includes(resolveOrigin(request) ?? '')) {
      throw new ForbiddenException({ code: 'ORIGIN_REJECTED', message: '请求来源不受信任。' });
    }
    return true;
  }
}
